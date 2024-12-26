
<?php
header('Content-Type: application/json');

$file = 'group_messages.json';

switch ($_SERVER['REQUEST_METHOD']) {
    case 'GET':
        if (file_exists($file)) {
            echo file_get_contents($file);
        } else {
            echo json_encode(['messages' => [], 'lastUpdate' => '']);
        }
        break;

    case 'PUT':
        $data = json_decode(file_get_contents('php://input'), true);
        if ($data) {
            file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));
            echo json_encode(['success' => true]);
        } else {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid data']);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
?>