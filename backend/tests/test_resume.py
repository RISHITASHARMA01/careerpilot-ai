from app.resume import analyze_text, detect_skills


def test_skill_boundaries():
    assert "java" not in detect_skills("JavaScript React")
    assert "javascript" in detect_skills("JavaScript React")


def test_skill_match():
    result = analyze_text("Python, Docker and FastAPI", "Python, Docker, Kubernetes")
    assert result["skill_match_percent"] == 67
    assert result["matched_skills"] == ["docker", "python"]
    assert result["missing_skills"] == ["kubernetes"]


def test_no_jd_skills():
    assert analyze_text("Python", "Excellent communicator")["skill_match_percent"] is None
