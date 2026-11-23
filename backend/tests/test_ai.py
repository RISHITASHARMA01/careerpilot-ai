import pytest
from app.ai import parse_feedback


def test_feedback_parser():
    result = parse_feedback('{"summary":"Good","strengths":["Python"],"improvements":["Add tests"],"suggested_bullets":[]}')
    assert result['summary'] == 'Good'
    assert result['strengths'] == ['Python']


def test_feedback_invalid():
    with pytest.raises(ValueError):
        parse_feedback('not json')
