from app.recommendations import rank_job

def test_rank_job_with_skills():
    result = rank_job(0.8, ['python'], 'Python and Docker')
    assert result['match_score'] == 72.5
    assert result['missing_skills'] == ['docker']

def test_rank_job_without_detected_skills():
    result = rank_job(0.7, ['python'], 'Strong communicator and team player')
    assert result['match_score'] == 70.0
    assert result['skill_coverage_percent'] is None
