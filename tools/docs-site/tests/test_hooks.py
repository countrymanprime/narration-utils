"""The include list, the link rewriting and the navigation order (ADR 0083). No MkDocs needed."""

import hooks
import pytest

REPO = "https://github.com/example/project"
PUBLISHED = ["README.md", "guide/README.md", "guide/page.md", "adr/0001.md"]


@pytest.fixture
def repo(tmp_path):
    """A repository with a docs/ folder: published pages, pages the include list leaves out, and files outside docs/."""
    files = {
        "docs/README.md": "# Home\n",
        "docs/guide/README.md": "# Guide\n",
        "docs/guide/page.md": "# Page\n",
        "docs/adr/0001.md": "# ADR\n",
        "docs/prds/plan.prd.md": "# Plan\n",
        "docs/research/note.md": "# Note\n",
        "docs/tools/one.md": "# One\n",
        "SECURITY.md": "# Security\n",
        "apps/desktop/main.go": "package main\n",
        "config/roadmap.json": "{}\n",
    }
    for name, text in files.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    (tmp_path / "apps/desktop/internal").mkdir()
    return tmp_path


def rewrite(repo, markdown, page="guide/page.md", ref="abc123"):
    return hooks.rewrite_links(markdown, page, docs_dir=repo / "docs", repo_root=repo, published=lambda uri: uri in PUBLISHED, repo_url=REPO, ref=ref)


class TestIncludeList:
    def test_reads_entries_and_drops_comments_and_blank_lines(self):
        text = "# heading\n\nREADME.md\n  guide/  \n# another\nadr/*.md\n"
        assert hooks.read_manifest(text) == ["README.md", "guide/", "adr/*.md"]

    @pytest.mark.parametrize(
        ("uri", "entry", "expected"),
        [
            ("guide/page.md", "guide/", True),
            ("guides/page.md", "guide/", False),
            ("README.md", "README.md", True),
            ("docs/README.md", "README.md", False),
            ("adr/0001.md", "adr/*.md", True),
            ("adr/deep/0001.md", "adr/*.md", False),
            ("adr/deep/0001.md", "adr/**/*.md", True),
            ("adr/0001.txt", "adr/*.md", False),
            ("a.md", "a.m?", True),
        ],
    )
    def test_matches_a_file_a_folder_or_a_glob(self, uri, entry, expected):
        assert hooks.matches_entry(uri, entry) is expected

    def test_a_page_not_listed_is_not_published(self):
        assert hooks.is_published("prds/plan.prd.md", ["guide/", "README.md"]) is False

    def test_an_entry_that_names_nothing_is_reported_so_a_rename_cannot_leave_a_stale_line(self):
        stale = hooks.unmatched_entries(["a.md", "guide/page.md"], ["a.md", "guide/", "gone/", "x/*.md"])
        assert stale == ["gone/", "x/*.md"]


class TestLinkRewriting:
    def test_a_link_to_a_published_page_is_left_alone(self, repo):
        text = "See [the index](README.md) and [the ADR](../adr/0001.md#why)."
        assert rewrite(repo, text) == text

    def test_a_link_to_a_page_the_list_leaves_out_becomes_its_github_file_view_at_the_ref(self, repo):
        assert rewrite(repo, "[plan](../prds/plan.prd.md#phase-1)") == f"[plan]({REPO}/blob/abc123/docs/prds/plan.prd.md#phase-1)"

    def test_a_link_that_leaves_docs_becomes_a_github_link(self, repo):
        text = "[security](../../SECURITY.md) and [json](../../config/roadmap.json) and [dir](../../apps/desktop/internal)"
        assert rewrite(repo, text) == (
            f"[security]({REPO}/blob/abc123/SECURITY.md) and [json]({REPO}/blob/abc123/config/roadmap.json) and [dir]({REPO}/tree/abc123/apps/desktop/internal)"
        )

    def test_a_link_to_a_folder_with_a_published_index_points_at_the_index(self, repo):
        assert rewrite(repo, "[guide](../guide/)", page="adr/0001.md") == "[guide](../guide/README.md)"

    def test_a_link_to_a_folder_with_no_published_index_becomes_a_github_tree_link(self, repo):
        assert rewrite(repo, "[tools](../tools/)", page="guide/page.md") == f"[tools]({REPO}/tree/abc123/docs/tools)"

    def test_a_link_to_something_that_does_not_exist_is_left_for_the_strict_build_to_report(self, repo):
        text = "[gone](../prds/deleted.prd.md) and [also](../../nope/file.md)"
        assert rewrite(repo, text) == text

    def test_external_links_anchors_and_mail_are_left_alone(self, repo):
        text = "[a](https://example.com/x.md) [b](#here) [c](mailto:me@example.com) [d](//cdn.example.com/x)"
        assert rewrite(repo, text) == text

    def test_an_image_is_rewritten_like_a_link_and_a_title_survives(self, repo):
        assert rewrite(repo, '![shot](../../config/roadmap.json "the roadmap")') == f'![shot]({REPO}/blob/abc123/config/roadmap.json "the roadmap")'

    def test_a_link_text_with_code_in_it_is_still_a_link(self, repo):
        assert rewrite(repo, "[`plan`](../prds/plan.prd.md)") == f"[`plan`]({REPO}/blob/abc123/docs/prds/plan.prd.md)"

    def test_links_inside_code_are_examples_and_stay_as_written(self, repo):
        text = "Write `[x](../prds/plan.prd.md)` like so:\n\n```md\n[y](../prds/plan.prd.md)\n```\n"
        assert rewrite(repo, text) == text

    def test_a_link_out_of_the_repository_is_left_alone(self, repo):
        text = "[x](../../../../elsewhere.md)"
        assert rewrite(repo, text) == text

    def test_the_ref_names_the_commit_or_branch_being_built(self, repo):
        assert rewrite(repo, "[plan](../prds/plan.prd.md)", ref="main").startswith(f"[plan]({REPO}/blob/main/")


class TestStorybookLink:
    def test_the_atlas_index_gets_an_absolute_link_to_the_storybook_beside_the_site(self):
        text = hooks.storybook_section("https://example.github.io/project/", "storybook/")
        assert "(https://example.github.io/project/storybook/)" in text


class TestNavigationOrder:
    def test_named_sections_come_first_in_the_given_order_and_the_rest_keep_their_place(self):
        keys = ["adr", "design", "roadmap", "guides", "zzz", "ui"]
        order = hooks.order_keys(keys, ["guides", "roadmap", "ui"])
        assert [keys[i] for i in order] == ["guides", "roadmap", "ui", "adr", "design", "zzz"]
