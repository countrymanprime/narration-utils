"""The build itself: it must pass on the real tree and fail on a dead link (ADR 0083). Runs MkDocs in strict mode."""

import os
import subprocess
import sys

import check_site
import pytest
from conftest import REPO_ROOT, SITE_PROJECT

HOOKS = (SITE_PROJECT / "hooks.py").as_posix()


def mkdocs(config, *extra):
    env = {**os.environ, "NO_MKDOCS_2_WARNING": "true"}
    return subprocess.run([sys.executable, "-m", "mkdocs", "build", "-f", str(config), *extra], capture_output=True, text=True, env=env, check=False)


@pytest.fixture
def tiny(tmp_path):
    """A repository with a two-page docs/ and a copy of the real hooks, config style and strictness."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "README.md").write_text("# Home\n\nSee [the guide](guide.md).\n", encoding="utf-8")
    (docs / "guide.md").write_text("# Guide\n\n## Steps\n\nBack to [home](README.md#home).\n", encoding="utf-8")
    (docs / "private.md").write_text("# Private\n", encoding="utf-8")
    (tmp_path / "include.txt").write_text("README.md\nguide.md\n", encoding="utf-8")
    (tmp_path / "mkdocs.yml").write_text(
        f"""site_name: tiny
site_url: https://example.github.io/tiny/
docs_dir: docs
site_dir: site
strict: true
hooks:
  - {HOOKS}
theme:
  name: material
validation:
  omitted_files: warn
  absolute_links: warn
  unrecognized_links: warn
  anchors: warn
extra:
  repo_url: https://github.com/example/tiny
  include_manifest: include.txt
  nav_titles: {{}}
  nav_order: []
  storybook_path: storybook/
  storybook_page: nothing.md
""",
        encoding="utf-8",
    )
    return tmp_path


def test_a_clean_tree_builds_and_its_output_has_no_dead_link(tiny):
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode == 0, result.stderr + result.stdout
    assert check_site.check_site(tiny / "site", base="/tiny/") == []
    assert not (tiny / "site" / "private").exists(), "a page the include list leaves out is not built"


def test_a_link_to_a_page_that_does_not_exist_fails_the_build(tiny):
    (tiny / "docs" / "guide.md").write_text("# Guide\n\nSee [nothing](missing.md).\n", encoding="utf-8")
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode != 0
    assert "missing.md" in result.stderr + result.stdout


def test_a_link_to_a_heading_that_does_not_exist_fails_the_build(tiny):
    (tiny / "docs" / "guide.md").write_text("# Guide\n\nSee [home](README.md#nowhere).\n", encoding="utf-8")
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode != 0
    assert "nowhere" in result.stderr + result.stdout


def test_a_link_to_a_page_the_list_leaves_out_is_sent_to_github_and_the_build_passes(tiny):
    (tiny / "docs" / "guide.md").write_text("# Guide\n\nSee [the private page](private.md).\n", encoding="utf-8")
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode == 0, result.stderr + result.stdout
    assert "https://github.com/example/tiny/blob/main/docs/private.md" in (tiny / "site" / "guide" / "index.html").read_text(encoding="utf-8")


def test_a_stale_line_in_the_include_list_fails_the_build(tiny):
    (tiny / "include.txt").write_text("README.md\nguide.md\nrenamed-away.md\n", encoding="utf-8")
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode != 0
    assert "renamed-away.md" in result.stderr + result.stdout


def test_the_real_tree_builds_strictly_with_zero_dead_internal_links(tmp_path):
    site = tmp_path / "site"
    result = mkdocs(SITE_PROJECT / "mkdocs.yml", "-d", str(site))
    assert result.returncode == 0, result.stderr + result.stdout
    assert (site / "guides" / "using-the-app" / "index.html").is_file(), "the guide index is the README.md of its folder"
    assert (REPO_ROOT / "docs" / "guides" / "using-the-app" / "README.md").is_file()
    # The atlas page links the Storybook that pages.yml publishes beside the site, so that one link is checked there, not here.
    problems = check_site.check_site(site, base="/narration-utils/")
    assert problems == []


def test_a_raw_text_tag_in_prose_does_not_swallow_the_rest_of_the_page(tiny):
    (tiny / "docs" / "guide.md").write_text(
        '# Guide\n\nA job named "<title> progress" is announced.\n\n## Consequences\n\nSee [them](#consequences).\n', encoding="utf-8"
    )
    result = mkdocs(tiny / "mkdocs.yml")
    assert result.returncode == 0, result.stderr + result.stdout
    html = (tiny / "site" / "guide" / "index.html").read_text(encoding="utf-8")
    assert "&lt;title&gt; progress" in html
    assert 'id="consequences"' in html
    assert check_site.check_site(tiny / "site", base="/tiny/") == []


def test_a_mermaid_fence_becomes_a_diagram_that_loads_no_script_from_another_site(tiny):
    """Material loads mermaid from unpkg.com unless a `mermaid` global exists, so the site ships the bundle itself (a visitor's browser asks no third party)."""
    bundle = tiny / "vendor" / "mermaid.min.js"
    bundle.parent.mkdir()
    bundle.write_text("/* a stand-in for the mermaid bundle */ window.mermaid = {};\n", encoding="utf-8")
    (bundle.parent / "LICENSE").write_text("MIT License (a stand-in)\n", encoding="utf-8")
    config = (tiny / "mkdocs.yml").read_text(encoding="utf-8")
    config = config.replace(
        "theme:\n",
        "markdown_extensions:\n  - pymdownx.superfences:\n      custom_fences:\n        - name: mermaid\n          class: mermaid\n          format: !!python/name:pymdownx.superfences.fence_code_format\nextra_javascript:\n  - assets/vendor/mermaid.min.js\ntheme:\n",
        1,
    )
    config = config.replace("extra:\n", "extra:\n  mermaid_bundle: vendor/mermaid.min.js\n", 1)
    (tiny / "mkdocs.yml").write_text(config, encoding="utf-8")
    (tiny / "docs" / "guide.md").write_text("# Guide\n\n```mermaid\nflowchart LR\n  A[one] --> B[two]\n```\n", encoding="utf-8")

    result = mkdocs(tiny / "mkdocs.yml")

    assert result.returncode == 0, result.stderr + result.stdout
    html = (tiny / "site" / "guide" / "index.html").read_text(encoding="utf-8")
    assert '<pre class="mermaid"><code>' in html
    assert "assets/vendor/mermaid.min.js" in html
    assert (tiny / "site" / "assets" / "vendor" / "mermaid.min.js").is_file()
    assert (tiny / "site" / "assets" / "vendor" / "LICENSE-mermaid.txt").is_file()
    assert check_site.check_site(tiny / "site", base="/tiny/") == []


def test_a_missing_mermaid_bundle_fails_the_build_and_says_how_to_get_it(tiny):
    config = (tiny / "mkdocs.yml").read_text(encoding="utf-8").replace("extra:\n", "extra:\n  mermaid_bundle: vendor/mermaid.min.js\n", 1)
    (tiny / "mkdocs.yml").write_text(config, encoding="utf-8")

    result = mkdocs(tiny / "mkdocs.yml")

    assert result.returncode != 0
    assert "pnpm install" in result.stderr + result.stdout


def test_the_real_site_ships_mermaid_itself_and_never_asks_unpkg(tmp_path):
    site = tmp_path / "site"
    result = mkdocs(SITE_PROJECT / "mkdocs.yml", "-d", str(site))
    assert result.returncode == 0, result.stderr + result.stdout
    page = (site / "architecture" / "codebase-map" / "index.html").read_text(encoding="utf-8")
    assert '<pre class="mermaid"><code>' in page
    assert (site / "assets" / "vendor" / "mermaid.min.js").stat().st_size > 100_000
    assert "unpkg.com" not in page
