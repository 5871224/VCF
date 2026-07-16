// VCF Analyzer — WebView2 host
// Manages engine.exe child processes; bridges WebView2 <-> engine via IPC.
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#define NOMINMAX
#include <windows.h>
#include <wrl/client.h>
#include <wrl/event.h>
#include <WebView2.h>
#include <string>
#include <vector>
#include <map>
#include <queue>
#include <functional>
#include <thread>
#include <mutex>
#include <future>
#include <atomic>
#include <sstream>
#include <filesystem>
#include <algorithm>
#include <memory>
#include "json.hpp"

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Callback;
using json = nlohmann::json;
namespace fs = std::filesystem;

// ── Globals ───────────────────────────────────────────────────
static HWND  g_hwnd = nullptr;
static ComPtr<ICoreWebView2Controller> g_ctrl;
static ComPtr<ICoreWebView2>           g_wv;
static std::wstring g_appDir;
static std::wstring g_enginePath;
static int          g_poolSize = 4;

#define WM_POST_MSG (WM_USER + 1)
struct PostMsgData { std::string json; };

// ── EngineProcess ─────────────────────────────────────────────
class EngineProcess {
    HANDLE hInW_   = INVALID_HANDLE_VALUE;
    HANDLE hOutR_  = INVALID_HANDLE_VALUE;
    HANDLE hProc_  = INVALID_HANDLE_VALUE;

    struct Req {
        std::string cmd;
        std::function<bool(const std::string&)> done;
        std::promise<std::vector<std::string>> prom;
    };

    std::mutex             qMtx_;
    std::queue<std::unique_ptr<Req>> q_;
    std::unique_ptr<Req>   cur_;
    std::vector<std::string> curLines_;
    std::thread            thr_;
    std::atomic<bool>      alive_{ false };
    std::wstring           enginePath_;

public:
    EngineProcess() = default;
    EngineProcess(const EngineProcess&) = delete;
    EngineProcess& operator=(const EngineProcess&) = delete;
    ~EngineProcess() { kill(); }

    void start(const std::wstring& ep) {
        enginePath_ = ep;
        SECURITY_ATTRIBUTES sa{ sizeof(sa), nullptr, TRUE };
        HANDLE hInR = INVALID_HANDLE_VALUE, hOutW = INVALID_HANDLE_VALUE;
        CreatePipe(&hInR,  &hInW_,  &sa, 0);
        CreatePipe(&hOutR_, &hOutW, &sa, 0);
        SetHandleInformation(hInW_,  HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(hOutR_, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFOW si{};
        si.cb          = sizeof(si);
        si.dwFlags     = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        si.hStdInput   = hInR;
        si.hStdOutput  = hOutW;
        si.hStdError   = GetStdHandle(STD_ERROR_HANDLE);

        PROCESS_INFORMATION pi{};
        std::wstring cmd = L"\"" + ep + L"\"";
        CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE,
                       CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
        CloseHandle(pi.hThread);
        hProc_ = pi.hProcess;
        CloseHandle(hInR);
        CloseHandle(hOutW);
        alive_ = true;
        thr_ = std::thread([this] { readLoop(); });
    }

    std::future<std::vector<std::string>> send(
            std::string cmd,
            std::function<bool(const std::string&)> done) {
        auto req   = std::make_unique<Req>();
        req->cmd   = std::move(cmd);
        req->done  = std::move(done);
        auto fut   = req->prom.get_future();
        {
            std::lock_guard<std::mutex> lk(qMtx_);
            q_.push(std::move(req));
        }
        dispatchNext();
        return fut;
    }

    void kill() {
        alive_ = false;
        if (hProc_ != INVALID_HANDLE_VALUE) {
            TerminateProcess(hProc_, 0);
            CloseHandle(hProc_); hProc_ = INVALID_HANDLE_VALUE;
        }
        if (hInW_  != INVALID_HANDLE_VALUE) { CloseHandle(hInW_);  hInW_  = INVALID_HANDLE_VALUE; }
        if (hOutR_ != INVALID_HANDLE_VALUE) { CloseHandle(hOutR_); hOutR_ = INVALID_HANDLE_VALUE; }
        if (thr_.joinable()) thr_.join();
        std::lock_guard<std::mutex> lk(qMtx_);
        if (cur_) { try { cur_->prom.set_value({}); } catch(...) {} cur_.reset(); }
        while (!q_.empty()) {
            try { q_.front()->prom.set_value({}); } catch(...) {}
            q_.pop();
        }
        curLines_.clear();
    }

    void restart() { kill(); start(enginePath_); }

private:
    void dispatchNext() {
        std::lock_guard<std::mutex> lk(qMtx_);
        if (cur_ || q_.empty()) return;
        cur_ = std::move(q_.front());
        q_.pop();
        curLines_.clear();
        std::string line = cur_->cmd + "\n";
        DWORD written;
        WriteFile(hInW_, line.c_str(), (DWORD)line.size(), &written, nullptr);
    }

    void readLoop() {
        char buf[4096];
        std::string partial;
        while (alive_) {
            DWORD n = 0;
            if (!ReadFile(hOutR_, buf, sizeof(buf) - 1, &n, nullptr) || n == 0) break;
            buf[n] = 0;
            partial += buf;
            size_t pos;
            while ((pos = partial.find('\n')) != std::string::npos) {
                std::string line = partial.substr(0, pos);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                partial.erase(0, pos + 1);
                onLine(line);
            }
        }
    }

    void onLine(const std::string& line) {
        std::unique_ptr<Req> finished;
        std::vector<std::string> finishedLines;
        {
            std::lock_guard<std::mutex> lk(qMtx_);
            if (!cur_) return;
            curLines_.push_back(line);
            if (cur_->done(line)) {
                finished      = std::move(cur_);
                finishedLines = std::move(curLines_);
                curLines_.clear();
            }
        }
        if (finished) {
            try { finished->prom.set_value(std::move(finishedLines)); } catch(...) {}
            dispatchNext();
        }
    }
};

// ── Pool + single engine ──────────────────────────────────────
static EngineProcess                            g_engine;
static std::vector<std::unique_ptr<EngineProcess>> g_pool;

// ── Protocol helpers ──────────────────────────────────────────
static std::string boardCmd(const json& arr) {
    std::ostringstream ss;
    std::vector<int> stones;
    for (int i = 0; i < 225; i++) {
        int v = arr[i].get<int>();
        if (v) { stones.push_back(i); stones.push_back(v); }
    }
    ss << "SETBOARD " << stones.size() / 2;
    for (int v : stones) ss << ' ' << v;
    return ss.str();
}

static json parseFindVCF(const std::vector<std::string>& lines) {
    int vcfCount = 0, nodeCount = 0;
    json winMoves = json::array();
    for (auto& ln : lines) {
        std::istringstream ss(ln);
        std::string tok; ss >> tok;
        if (tok == "VCFCOUNT")       ss >> vcfCount;
        else if (tok == "VCFPATH") {
            int n; ss >> n;
            json path = json::array();
            int v;
            while (ss >> v) path.push_back(v);
            winMoves.push_back(path);
        }
        else if (tok == "NODECOUNT") ss >> nodeCount;
    }
    return { {"vcfCount",vcfCount}, {"winMoves",winMoves}, {"nodeCount",nodeCount} };
}

static json parseGetLevelPoints(const std::vector<std::string>& lines) {
    json items = json::array();
    int nodeCount = 0;
    for (auto& ln : lines) {
        std::istringstream ss(ln);
        std::string tok; ss >> tok;
        if (tok == "ITEM") {
            int idx; std::string label;
            ss >> idx >> label;
            json item;
            item["idx"] = idx;
            if (label == "5" || label == "4") item["label"] = label;
            else                              item["label"] = std::stoi(label);
            items.push_back(item);
        } else if (tok == "NODECOUNT") {
            ss >> nodeCount;
        }
    }
    return { {"items", items}, {"nodeCount", nodeCount} };
}

// ── engineCmd (called from worker thread) ────────────────────
static json engineCmdImpl(const std::string& cmd, const json& p) {
    auto isOK   = [](const std::string& l){ return l == "OK"; };
    auto isDONE = [](const std::string& l){ return l == "DONE"; };

    if (cmd == "setGameRules") {
        g_engine.send("SETRULES " + std::to_string(p["rules"].get<int>()), isOK).get();
        return nullptr;
    }
    if (cmd == "findVCF") {
        auto arr     = p["arr"];
        int color    = p["color"].get<int>();
        int maxVCF   = p.value("maxVCF",   1);
        int maxDepth = p.value("maxDepth", 200);
        int maxNode  = p.value("maxNode",  5000000);
        // count stones for debug
        int stoneCount = 0;
        if (arr.is_array()) for (int i=0;i<225;i++) if (arr[i].get<int>()!=0) stoneCount++;
        std::string bc = boardCmd(arr);
        auto okLines = g_engine.send(bc, isOK).get();
        std::string setboardOk = okLines.empty() ? "NO_REPLY" : okLines[0];
        std::ostringstream ss;
        ss << "FINDVCF " << color << ' ' << maxVCF << ' ' << maxDepth << ' ' << maxNode;
        auto lines = g_engine.send(ss.str(),
            [](const std::string& l){ return l.rfind("NODECOUNT",0)==0; }).get();
        auto result = parseFindVCF(lines);
        // attach debug info
        result["_dbg"] = bc.size() > 60 ? bc.substr(0,60) : bc;
        result["_dbgStones"] = stoneCount;
        result["_dbgSetboardOk"] = setboardOk;
        return result;
    }
    if (cmd == "getBlockVCF") {
        auto arr         = p["arr"];
        int  color       = p["color"].get<int>();
        auto vcfMoves    = p["vcfMoves"];
        bool includeFour = p.value("includeFour", true);
        g_engine.send(boardCmd(arr), isOK).get();
        std::ostringstream ss;
        ss << "BLOCKVCF " << color << ' ' << (includeFour?1:0) << ' ' << vcfMoves.size();
        for (auto& m : vcfMoves) ss << ' ' << m.get<int>();
        auto lines = g_engine.send(ss.str(),
            [](const std::string& l){ return l.rfind("BLOCKPOINTS",0)==0; }).get();
        std::istringstream is(lines.empty() ? std::string() : lines[0]);
        std::string tok; int n; is >> tok >> n;
        json result = json::array();
        int v; while (is >> v) result.push_back(v);
        return result;
    }
    if (cmd == "isVCF") {
        auto arr   = p["arr"];
        int  color = p["color"].get<int>();
        auto moves = p["moves"];
        g_engine.send(boardCmd(arr), isOK).get();
        std::ostringstream ss;
        ss << "ISVCF " << color << ' ' << moves.size();
        for (auto& m : moves) ss << ' ' << m.get<int>();
        auto lines = g_engine.send(ss.str(),
            [](const std::string& l){ return l.rfind("ISVCF",0)==0; }).get();
        return !lines.empty() && lines[0].find("TRUE") != std::string::npos;
    }
    if (cmd == "getLevelPoints") {
        auto arr     = p["arr"];
        int  color   = p["color"].get<int>();
        int  pc      = p.value("placeColor", color);
        int  maxD    = p.value("maxDepth", 200);
        int  maxN    = p.value("maxNode",  5000000);
        g_engine.send(boardCmd(arr), isOK).get();
        std::ostringstream ss;
        ss << "GETLEVELPOINTS " << pc << ' ' << color << ' ' << maxD << ' ' << maxN;
        auto lines = g_engine.send(ss.str(), isDONE).get();
        return parseGetLevelPoints(lines);
    }
    if (cmd == "trimVCFGroups") {
        auto arr      = p["arr"];
        auto groups   = p["groups"];
        int  color    = p["color"].get<int>();
        int  oppColor = 3 - color;
        json processed = json::array();
        std::vector<std::string> seen;

        for (auto& grp : groups) {
            if (grp.empty()) continue;
            json fullArr = arr;
            for (int i = 0; i < (int)grp.size(); i++)
                fullArr[grp[i].get<int>()] = (i % 2 == 0) ? color : oppColor;

            g_engine.send(boardCmd(fullArr), isOK).get();

            int lastIdx = grp.back().get<int>();
            std::ostringstream ss;
            ss << "LEVELPOINT " << lastIdx << ' ' << color;
            auto lvLines = g_engine.send(ss.str(),
                [](const std::string& l){ return l.rfind("LEVEL",0)==0; }).get();

            int level = 0;
            if (!lvLines.empty()) {
                std::istringstream is(lvLines[0]);
                std::string tok; is >> tok >> level;
            }

            json trimmed = grp;
            if ((level & 0x0f) == 9) trimmed.erase(trimmed.end() - 1);

            std::vector<std::pair<int,int>> kv;
            for (int i = 0; i < (int)trimmed.size(); i++)
                kv.push_back({ trimmed[i].get<int>(), (i%2==0)?color:oppColor });
            std::sort(kv.begin(), kv.end());
            std::string key;
            for (auto& [idx, c] : kv) key += std::to_string(idx) + ':' + std::to_string(c) + ',';

            if (std::find(seen.begin(), seen.end(), key) == seen.end()) {
                seen.push_back(key);
                processed.push_back(grp);
            }
        }
        std::sort(processed.begin(), processed.end(), [](const json& a, const json& b){
            return a.size() < b.size();
        });
        return processed;
    }
    return nullptr;
}

// ── poolGetLevelPoints (called from worker thread) ────────────
static json poolGetLevelPointsImpl(const json& p) {
    auto arr     = p["arr"];
    int  color   = p["color"].get<int>();
    int  pc      = p.value("placeColor", color);
    int  maxD    = p.value("maxDepth", 200);
    int  maxN    = p.value("maxNode",  5000000);

    json idxJ = p.value("indices", json());
    std::vector<int> emptyIdx;
    if (!idxJ.is_null() && idxJ.is_array()) {
        for (auto& v : idxJ)
            if (arr[v.get<int>()].get<int>() == 0) emptyIdx.push_back(v.get<int>());
    } else {
        for (int i = 0; i < 225; i++)
            if (arr[i].get<int>() == 0) emptyIdx.push_back(i);
    }

    int N = (int)g_pool.size();
    std::vector<std::vector<int>> chunks(N);
    for (int i = 0; i < (int)emptyIdx.size(); i++) chunks[i % N].push_back(emptyIdx[i]);

    std::string board = boardCmd(arr);
    auto isOK   = [](const std::string& l){ return l == "OK"; };
    auto isDONE = [](const std::string& l){ return l == "DONE"; };

    std::vector<std::future<json>> futures;
    for (int i = 0; i < N; i++) {
        if (chunks[i].empty()) {
            std::promise<json> prom;
            prom.set_value(json{ {"items", json::array()}, {"nodeCount", 0} });
            futures.push_back(prom.get_future());
            continue;
        }
        // Capture by value what's needed
        std::string boardCopy = board;
        std::vector<int> chunkCopy = chunks[i];
        int pcCopy = pc, colorCopy = color, maxDCopy = maxD, maxNCopy = maxN;
        EngineProcess* eng = g_pool[i].get();

        futures.push_back(std::async(std::launch::async,
            [eng, boardCopy, chunkCopy, pcCopy, colorCopy, maxDCopy, maxNCopy,
             isOK, isDONE]() -> json
        {
            eng->send(boardCopy, isOK).get();
            std::ostringstream ss;
            ss << "GETLEVELPOINTS " << pcCopy << ' ' << colorCopy
               << ' ' << maxDCopy << ' ' << maxNCopy;
            for (int idx : chunkCopy) ss << ' ' << idx;
            auto lines = eng->send(ss.str(), isDONE).get();
            return parseGetLevelPoints(lines);
        }));
    }

    json allItems = json::array();
    int  totalNodes = 0;
    for (auto& f : futures) {
        auto r = f.get();
        for (auto& item : r["items"]) allItems.push_back(item);
        totalNodes += r["nodeCount"].get<int>();
    }
    return { {"items", allItems}, {"nodeCount", totalNodes} };
}

// ── Message dispatch ─────────────────────────────────────────
static void handleMessage(const std::string& msgJson) {
    json msg;
    try { msg = json::parse(msgJson); } catch(...) { return; }

    int         id    = msg["id"].get<int>();
    std::string type  = msg["type"].get<std::string>();
    std::string cmd   = msg.value("cmd", "");
    json        param = msg.value("param", json());

    std::thread([id, type, cmd, param]() {
        json result;
        try {
            if (type == "engine") {
                if (cmd == "cancel") { g_engine.restart(); result = nullptr; }
                else                   result = engineCmdImpl(cmd, param);
            } else if (type == "pool") {
                if (cmd == "cancel") {
                    for (auto& e : g_pool) e->restart();
                    result = nullptr;
                } else if (cmd == "getLevelPoints") {
                    result = poolGetLevelPointsImpl(param);
                } else if (cmd == "setRules") {
                    int rules = param["rules"].get<int>();
                    std::string ruleCmd = "SETRULES " + std::to_string(rules);
                    std::vector<std::future<std::vector<std::string>>> futs;
                    auto isOK = [](const std::string& l){ return l == "OK"; };
                    for (auto& e : g_pool) futs.push_back(e->send(ruleCmd, isOK));
                    for (auto& f : futs) f.get();
                    result = nullptr;
                }
            }
        } catch (...) { result = nullptr; }

        json reply = { {"id", id}, {"result", result} };
        auto* data = new PostMsgData{ reply.dump() };
        PostMessage(g_hwnd, WM_POST_MSG, 0, reinterpret_cast<LPARAM>(data));
    }).detach();
}

// ── Window procedure ─────────────────────────────────────────
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_KEYDOWN:
        if (wp == VK_F12 && g_wv) g_wv->OpenDevToolsWindow();
        break;
    case WM_SIZE:
        if (g_ctrl) {
            RECT rc; GetClientRect(hwnd, &rc);
            g_ctrl->put_Bounds(rc);
        }
        break;
    case WM_POST_MSG: {
        auto* data = reinterpret_cast<PostMsgData*>(lp);
        if (g_wv) {
            std::wstring ws(data->json.begin(), data->json.end());
            g_wv->PostWebMessageAsString(ws.c_str());
        }
        delete data;
        break;
    }
    case WM_DESTROY:
        g_engine.kill();
        for (auto& e : g_pool) e->kill();
        PostQuitMessage(0);
        break;
    default:
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    return 0;
}

// ── WinMain ───────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int nCmdShow) {
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    g_appDir     = fs::path(exePath).parent_path().wstring();
    g_enginePath = g_appDir + L"\\engine.exe";

    SYSTEM_INFO si; GetSystemInfo(&si);
    g_poolSize = std::max(1, std::min((int)si.dwNumberOfProcessors, 8));

    // Start engine processes
    g_engine.start(g_enginePath);
    for (int i = 0; i < g_poolSize; i++) {
        g_pool.push_back(std::make_unique<EngineProcess>());
        g_pool.back()->start(g_enginePath);
    }

    // Register window class
    WNDCLASSW wc{};
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = hInst;
    wc.lpszClassName = L"VCFAnalyzer";
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassW(&wc);

    g_hwnd = CreateWindowW(L"VCFAnalyzer", L"VCF Analyzer",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1200, 900,
        nullptr, nullptr, hInst, nullptr);
    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);

    // Init WebView2 (async, driven by message loop)
    std::wstring userDataDir = g_appDir + L"\\wv2data";
    CreateCoreWebView2EnvironmentWithOptions(nullptr, userDataDir.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [](HRESULT, ICoreWebView2Environment* env) -> HRESULT {
            env->CreateCoreWebView2Controller(g_hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [](HRESULT, ICoreWebView2Controller* ctrl) -> HRESULT {
                    g_ctrl = ctrl;
                    ctrl->get_CoreWebView2(&g_wv);

                    RECT rc; GetClientRect(g_hwnd, &rc);
                    ctrl->put_Bounds(rc);

                    // Settings
                    ComPtr<ICoreWebView2Settings> settings;
                    g_wv->get_Settings(&settings);
                    settings->put_IsScriptEnabled(TRUE);
                    settings->put_AreDefaultContextMenusEnabled(FALSE);
                    settings->put_IsStatusBarEnabled(FALSE);

                    // Virtual host — lets worker.js load without file:// restrictions
                    ComPtr<ICoreWebView2_3> wv3;
                    g_wv.As(&wv3);
                    if (wv3) {
                        wv3->SetVirtualHostNameToFolderMapping(
                            L"app.local", g_appDir.c_str(),
                            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                    }

                    // Inject workerCount before page scripts run
                    std::wstring script =
                        L"window._vcf_workerCount = " +
                        std::to_wstring(g_poolSize) + L";";
                    g_wv->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);

                    // Receive messages from JS
                    g_wv->add_WebMessageReceived(
                        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                            LPWSTR raw = nullptr;
                            args->TryGetWebMessageAsString(&raw);
                            if (raw) {
                                int n = WideCharToMultiByte(CP_UTF8, 0, raw, -1,
                                                            nullptr, 0, nullptr, nullptr);
                                std::string s(n - 1, '\0');
                                WideCharToMultiByte(CP_UTF8, 0, raw, -1,
                                                    s.data(), n, nullptr, nullptr);
                                handleMessage(s);
                                CoTaskMemFree(raw);
                            }
                            return S_OK;
                        }).Get(), nullptr);

                    g_wv->Navigate(L"https://app.local/makevcf.html");
                    return S_OK;
                }).Get());
            return S_OK;
        }).Get());

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }
    return 0;
}
