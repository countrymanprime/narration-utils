"""The output link check: it must fail on a dead link, on a dead fragment and on a link that leaves the base path."""

import check_site


def write(site, name, html):
    path = site / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


def page(*body):
    return "<!doctype html><html><body>" + "".join(body) + "</body></html>"


def test_a_site_whose_links_all_resolve_is_clean(tmp_path):
    write(tmp_path, "index.html", page('<a href="guide/">g</a><a href="guide/#top">t</a><img src="images/a.png"><a href="https://example.com/x">x</a>'))
    write(tmp_path, "guide/index.html", page('<h1 id="top">G</h1><a href="../">home</a><a href="../images/a.png">i</a>'))
    write(tmp_path, "images/a.png", "png")
    assert check_site.check_site(tmp_path) == []


def test_a_link_to_a_page_that_is_not_in_the_output_is_reported(tmp_path):
    write(tmp_path, "index.html", page('<a href="missing/">gone</a>'))
    assert check_site.check_site(tmp_path) == ["index.html: missing/ does not resolve to a file of the site"]


def test_a_dead_fragment_is_reported(tmp_path):
    write(tmp_path, "index.html", page('<a href="other/#nope">x</a><a href="#here">y</a><h2 id="here">h</h2>'))
    write(tmp_path, "other/index.html", page('<h1 id="top">O</h1>'))
    assert check_site.check_site(tmp_path) == ["index.html: other/#nope names no #nope on the page it links to"]


def test_a_link_that_leaves_the_output_folder_is_reported(tmp_path):
    write(tmp_path, "a/index.html", page('<a href="../../SECURITY.md">s</a>'))
    assert check_site.check_site(tmp_path) == ["a/index.html: ../../SECURITY.md does not resolve to a file of the site"]


def test_an_absolute_link_must_stay_under_the_base_path(tmp_path):
    write(tmp_path, "index.html", page('<link href="/project/style.css"><a href="/other/x/">o</a>'))
    write(tmp_path, "style.css", "body{}")
    assert check_site.check_site(tmp_path, base="/project/") == ["index.html: /other/x/ points outside the site base /project/"]


def test_an_absolute_url_under_the_site_url_is_an_internal_link(tmp_path):
    write(tmp_path, "index.html", page('<a href="https://example.github.io/project/storybook/">s</a>'))
    url = "https://example.github.io/project/"
    assert check_site.check_site(tmp_path, site_url=url) == [f"index.html: {url}storybook/ does not resolve to a file of the site"]
    write(tmp_path, "storybook/index.html", page("<p>ok</p>"))
    assert check_site.check_site(tmp_path, site_url=url) == []


def test_a_required_file_that_is_absent_is_reported(tmp_path):
    write(tmp_path, "index.html", page())
    assert check_site.check_site(tmp_path, require=("storybook/index.html",)) == ["required file missing: storybook/index.html"]


def test_the_command_exits_nonzero_on_a_dead_link_and_zero_on_a_clean_site(tmp_path, capsys):
    write(tmp_path, "index.html", page('<a href="nope/">x</a>'))
    assert check_site.main([str(tmp_path)]) == 1
    assert "dead internal link" in capsys.readouterr().err
    write(tmp_path, "index.html", page('<a href="#a" id="a">x</a>'))
    assert check_site.main([str(tmp_path)]) == 0


def test_the_command_refuses_a_folder_that_was_never_built(tmp_path):
    assert check_site.main([str(tmp_path / "not-built")]) == 2


def test_a_fragment_only_link_on_a_page_that_is_not_an_index_is_checked_against_that_page(tmp_path):
    write(tmp_path, "index.html", page('<h2 id="home">h</h2>'))
    write(tmp_path, "404.html", page('<a href="#home">x</a>'))
    assert check_site.check_site(tmp_path) == ["404.html: #home names no #home on the page it links to"]


def test_a_url_under_the_site_url_without_a_trailing_slash_is_internal_and_a_sibling_site_is_not(tmp_path):
    write(tmp_path, "index.html", page('<a href="https://example.github.io/project">a</a><a href="https://example.github.io/project-two/x">b</a>'))
    assert check_site.check_site(tmp_path, site_url="https://example.github.io/project/") == []


def test_srcset_and_poster_references_are_checked(tmp_path):
    write(tmp_path, "index.html", page('<img srcset="a.png 1x, b.png 2x"><video poster="c.png"></video>'))
    write(tmp_path, "a.png", "x")
    assert check_site.check_site(tmp_path) == [
        "index.html: b.png does not resolve to a file of the site",
        "index.html: c.png does not resolve to a file of the site",
    ]


def test_a_link_that_differs_only_in_case_is_dead_because_the_publishing_server_is_case_sensitive(tmp_path):
    write(tmp_path, "guide/index.html", page("<p>g</p>"))
    write(tmp_path, "index.html", page('<a href="Guide/">g</a>'))
    assert check_site.check_site(tmp_path) == ["index.html: Guide/ does not resolve to a file of the site"]
