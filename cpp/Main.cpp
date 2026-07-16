#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <filesystem>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include "Constants.h"

namespace fs = std::filesystem;

Rules g_rules = RENJU_RULES;

static std::wstring quote(const std::wstring& s) {
    return L"\"" + s + L"\"";
}

static std::wstring findScriptPath(const fs::path& exeDir) {
    const std::vector<fs::path> candidates = {
        exeDir / L"engine_node.js",
        exeDir.parent_path() / L"engine_node.js",
        exeDir.parent_path() / L"cpp" / L"engine_node.js",
        exeDir.parent_path().parent_path() / L"engine_node.js",
        exeDir.parent_path().parent_path().parent_path() / L"cpp" / L"engine_node.js",
    };

    for (const auto& path : candidates) {
        if (!path.empty() && fs::exists(path)) return path.wstring();
    }
    return L"";
}

int main() {
    wchar_t exePathBuf[MAX_PATH];
    GetModuleFileNameW(nullptr, exePathBuf, MAX_PATH);
    fs::path exePath(exePathBuf);
    fs::path exeDir = exePath.parent_path();

    std::wstring scriptPath = findScriptPath(exeDir);
    if (scriptPath.empty()) {
        std::cerr << "engine_node.js not found\n";
        return 1;
    }

    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE childStdInRead = nullptr;
    HANDLE childStdInWrite = nullptr;
    HANDLE childStdOutRead = nullptr;
    HANDLE childStdOutWrite = nullptr;

    if (!CreatePipe(&childStdInRead, &childStdInWrite, &sa, 0)) return 1;
    if (!CreatePipe(&childStdOutRead, &childStdOutWrite, &sa, 0)) return 1;

    SetHandleInformation(childStdInWrite, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(childStdOutRead, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdInput = childStdInRead;
    si.hStdOutput = childStdOutWrite;
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    PROCESS_INFORMATION pi{};
    std::wstring cmdLine = L"node " + quote(scriptPath);
    std::wstring workDir = fs::path(scriptPath).parent_path().wstring();

    if (!CreateProcessW(
            nullptr,
            cmdLine.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_NO_WINDOW,
            nullptr,
            workDir.c_str(),
            &si,
            &pi)) {
        std::cerr << "failed to start node bridge\n";
        return 1;
    }

    CloseHandle(childStdInRead);
    CloseHandle(childStdOutWrite);
    CloseHandle(pi.hThread);

    std::thread stdinThread([&]() {
        std::string line;
        while (std::getline(std::cin, line)) {
            line.push_back('\n');
            DWORD written = 0;
            if (!WriteFile(childStdInWrite, line.data(), static_cast<DWORD>(line.size()), &written, nullptr)) {
                break;
            }
        }
        CloseHandle(childStdInWrite);
    });

    std::thread stdoutThread([&]() {
        char buffer[4096];
        DWORD read = 0;
        while (ReadFile(childStdOutRead, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
            std::cout.write(buffer, read);
            std::cout.flush();
        }
        CloseHandle(childStdOutRead);
    });

    WaitForSingleObject(pi.hProcess, INFINITE);
    CloseHandle(pi.hProcess);

    if (stdinThread.joinable()) stdinThread.join();
    if (stdoutThread.joinable()) stdoutThread.join();

    return 0;
}
