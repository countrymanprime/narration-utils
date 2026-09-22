"""The site is generated from docs/ and nothing is copied by hand (ADR 0083, owner decision Q9)."""

import hooks
import yaml
from conftest import REPO_ROOT, SITE_PROJECT

CONFIG = yaml.safe_load((SITE_PROJECT / "mkdocs.yml").read_text(encoding="utf-8"))


def docs_files():
    return [path.relative_to(REPO_ROOT / "docs").as_posix() for path in (REPO_ROOT / "docs").rglob("*") if path.is_file()]


def test_the_source_of_the_site_is_the_docs_folder_itself():
    assert (SITE_PROJECT / CONFIG["docs_dir"]).resolve() == (REPO_ROOT / "docs").resolve()


def test_the_site_project_holds_no_content_of_its_own():
    stray = [
        path.relative_to(SITE_PROJECT).as_posix()
        for path in SITE_PROJECT.rglob("*")
        if path.is_file() and "build" not in path.relative_to(SITE_PROJECT).parts and path.suffix in {".md", ".markdown", ".webp", ".png"}
    ]
    assert stray == [], "pages and pictures belong in docs/, where the site reads them"
    assert not (SITE_PROJECT / "docs").exists()


def test_the_build_output_is_not_tracked():
    ignored = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "tools/docs-site/build/" in ignored
    assert CONFIG["site_dir"] == "build/site"


def test_every_line_of_the_include_list_names_something_in_docs():
    entries = hooks.read_manifest((SITE_PROJECT / CONFIG["extra"]["include_manifest"]).read_text(encoding="utf-8"))
    assert entries
    assert hooks.unmatched_entries(docs_files(), entries) == []


def test_research_and_the_planned_work_stay_out_until_reviewed():
    entries = hooks.read_manifest((SITE_PROJECT / CONFIG["extra"]["include_manifest"]).read_text(encoding="utf-8"))
    published = [uri for uri in docs_files() if hooks.is_published(uri, entries)]
    leaked = [uri for uri in published if uri.split("/")[0] in {"research", "prds", "operations", "workflows"}]
    assert leaked == []


def test_the_user_guide_and_the_roadmap_and_the_atlas_are_published():
    entries = hooks.read_manifest((SITE_PROJECT / CONFIG["extra"]["include_manifest"]).read_text(encoding="utf-8"))
    for uri in ("guides/using-the-app/README.md", "roadmap.md", "ui/atlas/index.md", "adr/README.md", "README.md"):
        assert hooks.is_published(uri, entries), uri
