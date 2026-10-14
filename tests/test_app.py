from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_page_and_assets():
    response = client.get("/")
    assert response.status_code == 200
    assert 'id="question-title"' in response.text
    for path in ("/static/app.js", "/static/style.css"):
        assert client.get(path).status_code == 200


def test_health():
    assert client.get("/api/health").json() == {"status": "ok", "app": "anna"}


def test_no_answer_collection_endpoint():
    assert client.post("/api/answers", json={"answer": "private"}).status_code == 404
