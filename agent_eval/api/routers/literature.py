"""
Literature Survey API — tracks related work and academic positioning.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_eval.literature import PAPERS, CATEGORIES, OUR_CONTRIBUTIONS, Paper

router = APIRouter(prefix="/api/v1/agent-eval/literature")


@router.get("/papers")
def list_papers(category: str = ""):
    papers = PAPERS
    if category:
        papers = [p for p in papers if p.category == category]
    return [p.model_dump() for p in sorted(papers, key=lambda x: (x.year, x.month), reverse=True)]


@router.get("/papers/{paper_id}")
def get_paper(paper_id: str):
    for p in PAPERS:
        if p.id == paper_id:
            return p.model_dump()
    raise HTTPException(404, f"Paper {paper_id} not found")


@router.get("/categories")
def get_categories():
    return CATEGORIES


@router.get("/positioning")
def get_positioning():
    """Our unique academic contributions and how we differ from related work."""
    return {
        "contributions": OUR_CONTRIBUTIONS,
        "total_related_papers": len(PAPERS),
        "attack_papers": len([p for p in PAPERS if p.category == "attack"]),
        "defense_papers": len([p for p in PAPERS if p.category == "defense"]),
        "benchmark_papers": len([p for p in PAPERS if p.category == "benchmark"]),
        "gap_statement": "现有工作集中在攻击方法（DDIPE, SkillTrojan, SkillAttack, BADSKILL）和大规模实证（Malicious Skills in the Wild），但缺乏系统性的多层防御框架。我们的五层递进分析是首个从文本到行为到组合的完整防御方案。",
    }


class PaperCreate(BaseModel):
    title: str
    authors: str = ""
    venue: str = ""
    year: int = 2026
    month: int = 0
    arxiv_id: str = ""
    url: str = ""
    category: str = ""
    relevance: str = ""
    key_finding: str = ""
    our_relation: str = ""
    tags: list[str] = []


@router.post("/papers")
def add_paper(req: PaperCreate):
    """Add a new paper to the registry."""
    pid = req.arxiv_id.replace(".", "-") if req.arxiv_id else f"custom-{len(PAPERS)}"
    paper = Paper(id=pid, **req.model_dump())
    PAPERS.append(paper)
    return paper.model_dump()


@router.delete("/papers/{paper_id}")
def remove_paper(paper_id: str):
    global PAPERS
    before = len(PAPERS)
    PAPERS[:] = [p for p in PAPERS if p.id != paper_id]
    if len(PAPERS) == before:
        raise HTTPException(404, f"Paper {paper_id} not found")
    return {"deleted": paper_id}
