import pytest
from app.jobs import DIMENSIONS, valid_vector, JobIn, SearchIn


def test_vector_validation():
    assert len(valid_vector([0.1] * DIMENSIONS)) == DIMENSIONS
    with pytest.raises(ValueError):
        valid_vector([0.1] * 10)
    with pytest.raises(ValueError):
        valid_vector([float('nan')] * DIMENSIONS)


def test_job_validation():
    job = JobIn(title="Backend Engineer", company="Example", description="Build Python APIs and distributed systems")
    assert job.location == "Remote"
    assert SearchIn(query="python engineer").limit == 10
