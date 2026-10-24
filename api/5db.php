<?php
/**
 * 5DB 1.0 authenticated private storage.
 *
 * Google login / account enablement is verified by the existing YXDB auth_me
 * endpoint. This API never parses legacy YXDB, LIB or VCFDB files.
 * User files live OUTSIDE DOCUMENT_ROOT and never in the deployed _site.
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

const FIVE_DB_MAX_FILE = 67108864;
const FIVE_DB_MAX_ACCOUNT = 134217728;
const FIVE_DB_MAX_RECORDS = 200;

function fail5(string $message, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function reply5(array $data): never {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function bearer5(): string {
    $value = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$value && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $header) {
            if (strtolower($name) === 'authorization') { $value = (string)$header; break; }
        }
    }
    if (!preg_match('/^Bearer\s+([A-Za-z0-9._~+\/=-]+)$/', trim($value), $m)) fail5('請先登入 Google 帳號', 401);
    return $m[1];
}
function authenticate5(string $token): string {
    $url = 'https://587.renju.org.tw/BD/api/yxdb.php?action=auth_me';
    $content = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer '.$token, 'Accept: application/json'],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $content = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'GET',
            'timeout' => 12,
            'ignore_errors' => true,
            'header' => "Authorization: Bearer {$token}\r\nAccept: application/json\r\n",
        ]]);
        $content = @file_get_contents($url, false, $ctx);
        $status = 0;
        foreach (($http_response_header ?? []) as $line) {
            if (preg_match('~^HTTP/\S+\s+(\d{3})~', $line, $m)) $status = (int)$m[1];
        }
    }
    if ($status === 401 || $status === 403) fail5('登入憑證無效，或帳號已停用', 401);
    if ($status !== 200 || !is_string($content)) fail5('登入驗證服務目前無法連線', 503);
    $answer = json_decode($content, true);
    $email = strtolower(trim((string)($answer['user']['email'] ?? '')));
    if (($answer['ok'] ?? null) === false || !filter_var($email, FILTER_VALIDATE_EMAIL))
        fail5('Google 登入驗證失敗', 401);
    return hash('sha256', $email);
}
function storage5(): string {
    $root = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    if (!$root || !is_dir($root)) fail5('私有儲存根目錄未設定', 503);
    $configured = getenv('VCF_5DB_STORAGE_DIR');
    $parent = realpath(dirname($root));
    if (!$parent) fail5('無法定位站台私有目錄', 503);
    // Shared hosts often place a subdomain DOCUMENT_ROOT inside public_html.
    // The sibling of DOCUMENT_ROOT could then itself be publicly reachable.
    // Walk up to the public web-root folder and use its parent instead.
    $privateBase = $parent;
    $publicRoot = null;
    $cursor = $root;
    while ($cursor !== dirname($cursor)) {
        if (preg_match('/^(public_html|www|htdocs|httpdocs|wwwroot|html)$/i', basename($cursor))) {
            $publicRoot = $cursor;
            $privateBase = dirname($cursor);
            break;
        }
        $cursor = dirname($cursor);
    }
    $path = is_string($configured) && trim($configured) !== ''
        ? rtrim(trim($configured), DIRECTORY_SEPARATOR)
        : $privateBase.DIRECTORY_SEPARATOR.'vcf-5db-private';
    if (!str_starts_with($path, DIRECTORY_SEPARATOR)) fail5('私有目錄必須是絕對路徑', 503);
    if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path))
        fail5('無法建立 5DB 私有儲存目錄，請設定 VCF_5DB_STORAGE_DIR', 503);
    $real = realpath($path);
    if (!$real || $real === $root || str_starts_with($real, $root.DIRECTORY_SEPARATOR)
        || ($publicRoot !== null
            && ($real === $publicRoot || str_starts_with($real, $publicRoot.DIRECTORY_SEPARATOR))))
        fail5('私有儲存目錄不能位於公開網站內', 503);
    return $real;
}
function userdir5(string $root, string $user): string {
    $dir = $root.DIRECTORY_SEPARATOR.$user;
    if (!is_dir($dir) && !@mkdir($dir, 0700) && !is_dir($dir)) fail5('無法建立帳號儲存目錄', 503);
    return $dir;
}
function manifest5($fp): array {
    rewind($fp);
    $raw = stream_get_contents($fp);
    if ($raw === false || $raw === '') return ['next_id' => 1, 'records' => []];
    $doc = json_decode($raw, true);
    if (!is_array($doc) || !isset($doc['records']) || !is_array($doc['records']))
        fail5('雲端索引資料損壞，已停止寫入以保護現有資料', 503);
    return $doc;
}
function writeManifest5($fp, array $doc): void {
    $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if (!is_string($json)) fail5('無法編碼雲端索引', 500);
    rewind($fp);
    if (!ftruncate($fp, 0) || fwrite($fp, $json) !== strlen($json) || !fflush($fp))
        fail5('無法寫入雲端索引', 503);
}
function verify5(string $body): int {
    $len = strlen($body);
    if ($len < 25 || $len > FIVE_DB_MAX_FILE || substr($body, 0, 4) !== '5DB1') fail5('只接受 5DB 1.0 二進位檔案');
    $width = ord($body[4]); $height = ord($body[5]);
    $mode = ord($body[6]); $side = ord($body[7]);
    if (!$width || !$height || $mode > 1 || ($side !== 1 && $side !== 2)) fail5('5DB 標頭錯誤');
    $declared = unpack('V', substr($body, 8, 4))[1];
    $sum = unpack('V', substr($body, 12, 4))[1];
    $nodes = unpack('V', substr($body, 16, 4))[1];
    if ($declared !== $len - 20 || $nodes < 1 || $nodes > 100000) fail5('5DB 長度或節點數不合法');
    if ((int)hexdec(hash('fnv1a32', substr($body, 20))) !== $sum) fail5('5DB 檔案校驗失敗');
    return $nodes;
}
function positiveId5(): int {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) fail5('棋譜編號不合法');
    return (int)$id;
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$action = (string)($_GET['action'] ?? '');
$method = (string)($_SERVER['REQUEST_METHOD'] ?? '');
if (!in_array($action, ['list','get','save','delete'], true)) fail5('不支援的 5DB 操作', 404);
if (($action === 'list' || $action === 'get') && $method !== 'GET') fail5('HTTP 方法錯誤', 405);
if (($action === 'save' || $action === 'delete') && $method !== 'POST') fail5('HTTP 方法錯誤', 405);
$user = authenticate5(bearer5());
$dir = userdir5(storage5(), $user);
$fp = @fopen($dir.DIRECTORY_SEPARATOR.'index.json', 'c+');
if (!$fp) fail5('雲端索引不可寫入', 503);
$write = $action === 'save' || $action === 'delete';
if (!flock($fp, $write ? LOCK_EX : LOCK_SH)) fail5('雲端索引無法鎖定', 503);
$manifest = manifest5($fp);
$records = $manifest['records'];
if ($action === 'list') {
    $items = array_values($records);
    usort($items, static fn($a, $b) => strcmp((string)$b['updated_at'], (string)$a['updated_at']));
    foreach ($items as &$item) unset($item['filename']);
    flock($fp, LOCK_UN); fclose($fp);
    reply5(['records' => $items]);
}
if ($action === 'get') {
    $id = positiveId5();
    $record = $records[(string)$id] ?? null;
    if (!$record) fail5('找不到該帳號的 5DB 棋譜', 404);
    $file = $dir.DIRECTORY_SEPARATOR.$id.'.5db';
    $payload = @file_get_contents($file);
    if (!is_string($payload)) fail5('5DB 雲端檔案不存在', 503);
    verify5($payload);
    flock($fp, LOCK_UN); fclose($fp);
    header_remove('Content-Type');
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="cloud-'.$id.'.5db"');
    header('X-5DB-Id: '.$id);
    header('X-5DB-Title: '.rawurlencode((string)($record['title'] ?? '')));
    header('X-5DB-File-Name: '.rawurlencode((string)($record['file_name'] ?? $record['title'] ?? '')));
    header('X-5DB-Record-Count: '.(int)$record['record_count']);
    header('X-5DB-Size: '.strlen($payload));
    header('Content-Length: '.strlen($payload));
    echo $payload;
    exit;
}
if ($action === 'save') {
    $size = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($size > FIVE_DB_MAX_FILE) fail5('5DB 超過 64 MB 上限', 413);
    $payload = file_get_contents('php://input');
    if (!is_string($payload)) fail5('無法讀取 5DB 檔案');
    $nodeCount = verify5($payload);
    $total = array_sum(array_map(static fn($r) => (int)($r['compressed_size'] ?? 0), $records));
    if (count($records) >= FIVE_DB_MAX_RECORDS || $total + strlen($payload) > FIVE_DB_MAX_ACCOUNT)
        fail5('雲端已達 200 份棋譜或 128 MB 容量上限', 413);
    $title = trim((string)($_GET['title'] ?? ''));
    if (strlen($title) > 1000 || preg_match_all('/./us', $title, $matches) === false
        || count($matches[0]) > 250) fail5('棋譜標題過長');
    $fileName = trim((string)($_GET['file_name'] ?? ''));
    if (preg_match('/\\.5db$/i', $fileName)) $fileName = substr($fileName, 0, -4);
    if ($fileName === '' || strlen($fileName) > 1000
        || preg_match('~[\\\\/:*?"<>|\\x00-\\x1f]~', $fileName)
        || preg_match_all('/./us', $fileName, $fileChars) === false
        || count($fileChars[0]) > 250) fail5('檔案名稱不合法');
    $id = (int)($manifest['next_id'] ?? 1);
    if ($id <= 0 || $id >= 2147483647) fail5('棋譜編號已達上限');
    $file = $dir.DIRECTORY_SEPARATOR.$id.'.5db';
    $tmp = $dir.DIRECTORY_SEPARATOR.'.'.$id.'.'.bin2hex(random_bytes(8)).'.tmp';
    if (file_put_contents($tmp, $payload, LOCK_EX) !== strlen($payload)
        || !@chmod($tmp, 0600) || !rename($tmp, $file)) {
        @unlink($tmp);
        fail5('5DB 寫入失敗', 503);
    }
    $now = gmdate('Y-m-d\TH:i:s\Z');
    $item = [
        'id' => $id, 'file_name' => $fileName, 'title' => $title, 'record_count' => $nodeCount,
        'compressed_size' => strlen($payload), 'created_at' => $now, 'updated_at' => $now,
    ];
    $manifest['next_id'] = $id + 1;
    $manifest['records'][(string)$id] = $item;
    writeManifest5($fp, $manifest);
    flock($fp, LOCK_UN); fclose($fp);
    reply5(['id' => $id, 'record_count' => $nodeCount, 'compressed_size' => strlen($payload)]);
}
$id = positiveId5();
if (!isset($records[(string)$id])) fail5('找不到該帳號的 5DB 棋譜', 404);
$file = $dir.DIRECTORY_SEPARATOR.$id.'.5db';
if (is_file($file) && !unlink($file)) fail5('無法刪除 5DB 檔案', 503);
unset($manifest['records'][(string)$id]);
writeManifest5($fp, $manifest);
flock($fp, LOCK_UN); fclose($fp);
reply5(['id' => $id]);
