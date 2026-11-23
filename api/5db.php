<?php
/**
 * 5DB 1.0 authenticated private storage.
 *
 * Identity is verified through the shared Sched HttpOnly login cookie and
 * AuthTokenService; Google and Email users have the same private storage.
 * This API never parses legacy YXDB, LIB or VCFDB files.
 * User files live OUTSIDE DOCUMENT_ROOT and never in the deployed _site.
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

const FIVE_DB_MAX_FILE = 67108864;
const FIVE_DB_MAX_ACCOUNT = 134217728;
// Limit request bytes for reliable parsing, not the number of chess records.
const FIVE_DB_MOVE_REQUEST_BYTES = 262144;

function fail5(string $message, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function reply5(array $data): never {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function authenticate5(): string {
    if (empty($_COOKIE['sched_site_auth']) && empty($_COOKIE['sched_auth']))
        fail5('請先登入協會會員帳號', 401);

    // Both applications are deployed under the same website root.
    $schedApi = realpath(dirname(__DIR__, 2).'/Sched/api');
    if (!$schedApi || !is_file($schedApi.'/AuthTokenService.php') || !is_file($schedApi.'/config.php'))
        fail5('共用會員驗證服務尚未部署', 503);

    try {
        require_once $schedApi.'/AuthTokenService.php';
        $config = require $schedApi.'/config.php';
        $db = $config['db'] ?? [];
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
            $db['host'] ?? '', $db['dbname'] ?? '', $db['charset'] ?? 'utf8mb4');
        $pdo = new PDO($dsn, (string)($db['user'] ?? ''), (string)($db['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $user = authCurrentUser($pdo, $config);
    } catch (Throwable $error) {
        error_log('5DB Sched authentication failed: '.$error->getMessage());
        fail5('共用會員驗證服務目前無法使用', 503);
    }
    if (!$user) fail5('會員登入已失效，請重新登入', 401);
    $email = strtolower(trim((string)($user['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail5('會員帳號缺少有效 Email', 403);
    // Preserve the existing private directory for users who already saved 5DB.
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
    if ($raw === false || $raw === '') return ['next_id' => 1, 'records' => [], 'next_folder_id' => 1, 'folders' => []];
    $doc = json_decode($raw, true);
    if (!is_array($doc) || !isset($doc['records']) || !is_array($doc['records']))
        fail5('雲端索引資料損壞，已停止寫入以保護現有資料', 503);
    if (!isset($doc['folders'])) $doc['folders'] = [];
    if (!is_array($doc['folders'])) fail5('雲端資料夾索引損壞，已停止寫入以保護現有資料', 503);
    if (!isset($doc['next_folder_id'])) $doc['next_folder_id'] = 1;
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
    if (!$width || !$height || $mode > 2 || ($side !== 1 && $side !== 2)) fail5('5DB 標頭錯誤');
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
function folderId5(array $manifest, string $field): int {
    $value = (string)($_GET[$field] ?? '0');
    if (!preg_match('/^(0|[1-9][0-9]*)$/D', $value) || strlen($value) > 10) fail5('資料夾編號不合法');
    $id = (int)$value;
    if ($id > 2147483647 || ($id > 0 && !isset($manifest['folders'][(string)$id])))
        fail5('資料夾不存在', 404);
    return $id;
}
function folderName5(): string {
    $name = trim((string)($_GET['name'] ?? ''));
    if ($name === '' || strlen($name) > 512 || (preg_match_all('/./us', $name, $characters) === false || count($characters[0]) > 80)
        || preg_match('~[\\\\/:*?"<>|\\x00-\\x1f]~', $name))
        fail5('資料夾名稱不合法（最多 80 字，不能包含路徑符號）');
    return $name;
}
function uniqueSibling5(array $folders, int $parentId, string $name, int $except = 0): void {
    foreach ($folders as $folder) {
        if ((int)$folder['id'] !== $except && (int)$folder['parent_id'] === $parentId
            && $folder['name'] === $name) fail5('同一層已有相同名稱的資料夾');
    }
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
$expectedOrigin = ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
    (strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https')
    ? 'https://' : 'http://') . (string)($_SERVER['HTTP_HOST'] ?? '');
if (($origin !== '' && $origin !== $expectedOrigin) ||
    ($origin === '' && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site'))
    fail5('不允許的請求來源', 403);
$action = (string)($_GET['action'] ?? '');
$method = (string)($_SERVER['REQUEST_METHOD'] ?? '');
if (!in_array($action, ['list','get','save','delete','folder_create','folder_rename','folder_move','folder_delete','record_move','records_move'], true)) fail5('不支援的 5DB 操作', 404);
if (($action === 'list' || $action === 'get') && $method !== 'GET') fail5('HTTP 方法錯誤', 405);
if (!in_array($action, ['list','get'], true) && $method !== 'POST') fail5('HTTP 方法錯誤', 405);
$user = authenticate5();
$dir = userdir5(storage5(), $user);
$fp = @fopen($dir.DIRECTORY_SEPARATOR.'index.json', 'c+');
if (!$fp) fail5('雲端索引不可寫入', 503);
$write = !in_array($action, ['list','get'], true);
if (!flock($fp, $write ? LOCK_EX : LOCK_SH)) fail5('雲端索引無法鎖定', 503);
$manifest = manifest5($fp);
$records = $manifest['records'];
if ($action === 'list') {
    $items = array_values($records);
    usort($items, static fn($a, $b) => strcmp((string)$b['updated_at'], (string)$a['updated_at']));
    foreach ($items as &$item) unset($item['filename']);
    flock($fp, LOCK_UN); fclose($fp);
    reply5(['records' => $items, 'folders' => array_values($manifest['folders'])]);
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
    // The small list-only preview is derived from the already-validated
    // document on the client; it is never used as a file path or game data.
    $preview = (string)($_SERVER['HTTP_X_5DB_PREVIEW'] ?? '');
    if ($preview !== '') {
        if (strlen($preview) > 700
            || !preg_match('/^([0-9]{1,3})x([0-9]{1,3}):([012]+)$/D', $preview, $parts)
            || (int)$parts[1] !== ord($payload[4])
            || (int)$parts[2] !== ord($payload[5])
            || strlen($parts[3]) !== (int)$parts[1] * (int)$parts[2])
            fail5('5DB 棋盤縮圖資料不合法');
    }
    $total = array_sum(array_map(static fn($r) => (int)($r['compressed_size'] ?? 0), $records));
    if ($total + strlen($payload) > FIVE_DB_MAX_ACCOUNT)
        fail5('雲端已達 128 MB 容量上限', 413);
    $title = trim((string)($_GET['title'] ?? ''));
    if (strlen($title) > 1000 || preg_match_all('/./us', $title, $matches) === false
        || count($matches[0]) > 250) fail5('棋譜標題過長');
    $fileName = trim((string)($_GET['file_name'] ?? ''));
    if (preg_match('/\\.5db$/i', $fileName)) $fileName = substr($fileName, 0, -4);
    if ($fileName === '' || strlen($fileName) > 1000
        || preg_match('~[\\\\/:*?"<>|\\x00-\\x1f]~', $fileName)
        || preg_match_all('/./us', $fileName, $fileChars) === false
        || count($fileChars[0]) > 250) fail5('檔案名稱不合法');
    $folderId = folderId5($manifest, 'folder_id');
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
        'preview' => $preview, 'folder_id' => $folderId,
    ];
    $manifest['next_id'] = $id + 1;
    $manifest['records'][(string)$id] = $item;
    writeManifest5($fp, $manifest);
    flock($fp, LOCK_UN); fclose($fp);
    reply5(['id' => $id, 'record_count' => $nodeCount, 'compressed_size' => strlen($payload)]);
}
if (str_starts_with($action, 'folder_') || $action === 'record_move' || $action === 'records_move') {
    $folders = $manifest['folders'];
    if ($action === 'folder_create') {
        $parentId = folderId5($manifest, 'parent_id');
        $name = folderName5();
        uniqueSibling5($folders, $parentId, $name);
        $id = (int)$manifest['next_folder_id'];
        if ($id < 1 || $id >= 2147483647) fail5('資料夾編號已達上限');
        $manifest['next_folder_id'] = $id + 1;
        $folder = ['id' => $id, 'name' => $name, 'parent_id' => $parentId];
        $manifest['folders'][(string)$id] = $folder;
        writeManifest5($fp, $manifest);
        reply5(['folder' => $folder]);
    }
    if ($action === 'records_move') {
        // Move multiple records by folder_id only. Never read or rewrite .5db binaries.
        // Validate all IDs before the single manifest write: no partial server-side move.
        $folderId = folderId5($manifest, 'folder_id');
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > FIVE_DB_MOVE_REQUEST_BYTES)
            fail5('批次移動請求過大，請由網頁自動分批', 413);
        $raw = file_get_contents('php://input');
        if (!is_string($raw) || strlen($raw) > FIVE_DB_MOVE_REQUEST_BYTES)
            fail5('批次移動請求過大，請由網頁自動分批', 413);
        $body = json_decode($raw, true);
        $ids = is_array($body) ? ($body['ids'] ?? null) : null;
        if (!is_array($ids) || !array_is_list($ids) || !$ids)
            fail5('批次移動資料格式不合法');
        $unique = [];
        foreach ($ids as $id) {
            if (!is_int($id) || $id <= 0 || $id >= 2147483647
                || !isset($records[(string)$id])) fail5('批次移動包含無效或不存在的棋譜編號', 400);
            $unique[(string)$id] = $id;
        }
        $changed = 0;
        foreach ($unique as $id) {
            if ((int)($records[(string)$id]['folder_id'] ?? 0) !== $folderId) {
                $manifest['records'][(string)$id]['folder_id'] = $folderId;
                $changed++;
            }
        }
        if ($changed > 0) writeManifest5($fp, $manifest);
        flock($fp, LOCK_UN); fclose($fp);
        reply5(['folder_id' => $folderId, 'moved' => $changed, 'ids' => array_values($unique)]);
    }
    if ($action === 'record_move') {
        $id = positiveId5();
        if (!isset($records[(string)$id])) fail5('找不到該帳號的棋譜', 404);
        $folderId = folderId5($manifest, 'folder_id');
        $manifest['records'][(string)$id]['folder_id'] = $folderId;
        writeManifest5($fp, $manifest);
        reply5(['id' => $id, 'folder_id' => $folderId]);
    }
    $id = positiveId5();
    if (!isset($folders[(string)$id])) fail5('找不到資料夾', 404);
    if ($action === 'folder_rename') {
        $name = folderName5();
        uniqueSibling5($folders, (int)$folders[(string)$id]['parent_id'], $name, $id);
        $manifest['folders'][(string)$id]['name'] = $name;
        writeManifest5($fp, $manifest);
        reply5(['folder' => $manifest['folders'][(string)$id]]);
    }
    if ($action === 'folder_move') {
        $parentId = folderId5($manifest, 'parent_id');
        $cursor = $parentId;
        while ($cursor !== 0) {
            if ($cursor === $id) fail5('不能將資料夾移到自己或下層資料夾');
            $cursor = (int)$folders[(string)$cursor]['parent_id'];
        }
        uniqueSibling5($folders, $parentId, (string)$folders[(string)$id]['name'], $id);
        if ((int)$manifest['folders'][(string)$id]['parent_id'] !== $parentId) {
            $manifest['folders'][(string)$id]['parent_id'] = $parentId;
            writeManifest5($fp, $manifest);
        }
        flock($fp, LOCK_UN); fclose($fp);
        reply5(['folder' => $manifest['folders'][(string)$id]]);
    }
    foreach ($folders as $folder) {
        if ((int)$folder['parent_id'] === $id) fail5('資料夾仍有子資料夾，請先移動或刪除子資料夾');
    }
    foreach ($records as $record) {
        if ((int)($record['folder_id'] ?? 0) === $id) fail5('資料夾仍有棋譜，請先移動棋譜');
    }
    unset($manifest['folders'][(string)$id]);
    writeManifest5($fp, $manifest);
    reply5(['id' => $id]);
}
$id = positiveId5();
if (!isset($records[(string)$id])) fail5('找不到該帳號的 5DB 棋譜', 404);
$file = $dir.DIRECTORY_SEPARATOR.$id.'.5db';
if (is_file($file) && !unlink($file)) fail5('無法刪除 5DB 檔案', 503);
unset($manifest['records'][(string)$id]);
writeManifest5($fp, $manifest);
flock($fp, LOCK_UN); fclose($fp);
reply5(['id' => $id]);
