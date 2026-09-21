"""The third-party notices: what ships, under which licence, and the text that goes with it.

Docs security and hygiene PRD, phase 7. The release attaches `THIRD-PARTY-NOTICES.txt`, so a wrong or empty report is a wrong or
empty legal notice: these tests pin how each ecosystem is read (from fixtures, so they run anywhere) and, where the tools exist, that
the real report names every direct dependency of the Go module and the UI.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import notices

REPO_ROOT = Path(__file__).resolve().parents[3]
BS = chr(92)


def win(path: str) -> str:
    return path.replace("/", BS)


SITE = "C:/repo/.venv/Lib/site-packages"
TOC = repr(
    (
        ["script.py"],
        [
            ("numpy._core", win(f"{SITE}/numpy/_core/__init__.py"), "PYMODULE"),
            ("os", win("C:/Python312/Lib/os.py"), "PYMODULE"),
            ("typing_extensions", win(f"{SITE}/typing_extensions.py"), "PYMODULE"),
            (win("av.libs/avcodec-62.dll"), win(f"{SITE}/av.libs/avcodec-62.dll"), "BINARY"),
            (win("cmudict-1.1.3.dist-info/METADATA"), win(f"{SITE}/cmudict-1.1.3.dist-info/METADATA"), "DATA"),
            (win("piper/espeak-ng-data/en_dict"), win(f"{SITE}/piper/espeak-ng-data/en_dict"), "DATA"),
            ("_pyinstaller_hooks_contrib", win(f"{SITE}/_pyinstaller_hooks_contrib/__init__.py"), "PYMODULE"),
        ],
    )
)


class TestFrozenBundle:
    def test_reads_the_packages_the_freeze_took_from_site_packages_and_nothing_from_the_standard_library(self):
        found = notices.read_frozen_toc(TOC)

        assert found.modules == {"numpy", "typing_extensions", "piper", "_pyinstaller_hooks_contrib"}

    def test_reads_vendored_native_folders_and_the_distributions_whose_metadata_was_copied(self):
        found = notices.read_frozen_toc(TOC)

        assert found.vendored == {"av.libs"}
        assert found.dist_infos == {"cmudict": "1.1.3"}

    def test_a_toc_that_is_not_a_python_literal_is_an_error_not_an_empty_report(self):
        with pytest.raises(notices.NoticeError, match="not a PyInstaller table of contents"):
            notices.read_frozen_toc("this is not a literal")

    def test_maps_top_level_modules_to_their_distributions_and_reports_what_it_cannot_map(self):
        mapping = {"numpy": ["numpy"], "typing_extensions": ["typing_extensions"], "piper": ["piper-tts"]}

        distributions, unmapped = notices.distributions_of({"numpy", "piper", "ghost"}, {"cmudict": "1.1.3"}, mapping)

        assert distributions == {"numpy", "piper-tts", "cmudict"}
        assert unmapped == {"ghost"}


class TestLicenceNames:
    def test_prefers_the_spdx_expression(self):
        assert notices.python_license({"License-Expression": "BSD-3-Clause", "License": "whatever"}, []) == "BSD-3-Clause"

    def test_maps_a_short_free_text_field(self):
        assert notices.python_license({"License": "MIT License"}, []) == "MIT"
        assert notices.python_license({"License": "Apache 2.0"}, []) == "Apache-2.0"

    def test_reads_a_classifier_when_the_field_is_a_whole_licence_text(self):
        long_text = "GNU GENERAL PUBLIC LICENSE\n" + "x" * 200
        classifiers = ["License :: OSI Approved :: GNU General Public License v3 or later (GPLv3+)"]

        assert notices.python_license({"License": long_text}, classifiers) == "GPL-3.0-or-later"

    def test_accepts_a_free_text_field_that_is_already_an_spdx_expression(self):
        assert notices.python_license({"License": "GPL-3.0-or-later"}, []) == "GPL-3.0-or-later"
        assert notices.python_license({"License": "MPL-2.0 AND MIT"}, []) == "MPL-2.0 AND MIT"

    def test_says_unknown_rather_than_guessing(self):
        assert notices.python_license({}, []) == "UNKNOWN"
        assert notices.python_license({"License": "See LICENSE.txt"}, []) == "UNKNOWN"

    def test_classifies_the_texts_go_modules_ship(self):
        assert notices.classify_text("Permission is hereby granted, free of charge, to any person obtaining a copy of this software") == "MIT"
        assert notices.classify_text("Redistribution and use in source and binary forms ... Neither the name of the copyright holder") == "BSD-3-Clause"
        assert (
            notices.classify_text("Redistribution and use in source and binary forms ... THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS") == "BSD-2-Clause"
        )
        assert notices.classify_text("Apache License\nVersion 2.0, January 2004") == "Apache-2.0"
        assert notices.classify_text("Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee") == "ISC"
        assert notices.classify_text("Mozilla Public License Version 2.0") == "MPL-2.0"
        assert notices.classify_text("all rights reserved, ask us") == "UNKNOWN"


class TestNpmAndGo:
    def test_reads_pnpm_licenses_output(self, tmp_path):
        (tmp_path / "LICENSE").write_text("MIT text for react", encoding="utf-8")
        listing = {"MIT": [{"name": "react", "versions": ["19.2.0"], "paths": [str(tmp_path)], "license": "MIT", "homepage": "https://react.dev"}]}

        components = notices.parse_pnpm_licenses(json.dumps(listing))

        assert [(c.ecosystem, c.name, c.version, c.license, c.homepage) for c in components] == [("npm", "react", "19.2.0", "MIT", "https://react.dev")]
        assert components[0].texts == ("MIT text for react",)

    def test_reads_go_list_and_drops_the_main_module_and_the_standard_library(self, tmp_path):
        (tmp_path / "LICENSE").write_text("Permission is hereby granted, free of charge, to any person obtaining a copy", encoding="utf-8")
        stream = "\n".join(
            [
                json.dumps({"ImportPath": "fmt", "Standard": True}),
                json.dumps({"ImportPath": "example.com/app/x", "Module": {"Path": "example.com/app", "Main": True, "Dir": "/x"}}),
                json.dumps({"ImportPath": "github.com/a/b/c", "Module": {"Path": "github.com/a/b", "Version": "v1.2.3", "Dir": str(tmp_path)}}),
                json.dumps({"ImportPath": "github.com/a/b/d", "Module": {"Path": "github.com/a/b", "Version": "v1.2.3", "Dir": str(tmp_path)}}),
            ]
        )

        components = notices.parse_go_list(stream)

        assert [(c.name, c.version, c.license) for c in components] == [("github.com/a/b", "v1.2.3", "MIT")]

    def test_reads_concatenated_json_objects_the_way_go_list_prints_them(self):
        stream = json.dumps({"ImportPath": "fmt", "Standard": True}, indent=1) + "\n" + json.dumps({"ImportPath": "os", "Standard": True}, indent=1)

        assert notices.parse_go_list(stream) == []

    def test_lists_the_direct_requirements_of_a_go_module(self):
        go_mod = (
            "module x\n\ngo 1.26\n\nrequire (\n\tgithub.com/a/b v1.0.0\n\tgolang.org/x/sys v0.1.0\n)\n\nrequire (\n\tgithub.com/c/d v2.0.0 // indirect\n)\n"
        )

        assert notices.go_direct_requirements(go_mod) == {"github.com/a/b", "golang.org/x/sys"}


class TestReviewFindings:
    """What a reviewer of the tool found: each way a report could be written wrong without failing."""

    def test_a_gpl_text_that_mentions_the_affero_licence_is_still_gpl(self):
        gpl3 = "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n" + "x " * 400 + "GNU Affero General Public License"
        gpl2 = "GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991\n" + "x " * 400 + "GNU Lesser General Public License"

        assert notices.classify_text(gpl3) == "GPL-3.0"
        assert notices.classify_text(gpl2) == "GPL-2.0"

    def test_the_licence_title_decides_between_agpl_lgpl_and_gpl(self):
        assert notices.classify_text("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007") == "AGPL-3.0"
        assert notices.classify_text("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999") == "LGPL-2.1"
        assert notices.classify_text("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007") == "LGPL-3.0"

    def test_a_reviewed_entry_only_names_a_licence_that_was_unknown(self):
        known = [notices.Component("go", "example.com/m", "v1", "MIT", "", ("t",), "apps/desktop")]

        with pytest.raises(notices.NoticeError, match="example.com/m"):
            notices.render_report(version="0.1.0", components=known, program_license="AGPL", catalogs=[], reviewed={"example.com/m": "GPL-3.0-only"})

    def test_a_reviewed_entry_that_matches_nothing_is_an_error_so_a_stale_decision_cannot_hide_a_change(self):
        with pytest.raises(notices.NoticeError, match="ghost"):
            notices.render_report(version="0.1.0", components=[], program_license="AGPL", catalogs=[], reviewed={"ghost": "MIT"})

    def test_pnpms_own_spelling_of_no_licence_is_unknown_too(self):
        unknown = [notices.Component("npm", "mystery", "1.0.0", "Unknown", "", ("t",), "apps/ui")]

        with pytest.raises(notices.NoticeError, match="mystery"):
            notices.render_report(version="0.1.0", components=unknown, program_license="AGPL", catalogs=[])

    def test_a_component_with_no_licence_text_is_refused_unless_a_person_said_it_is_fine(self):
        bare = [notices.Component("python", "bare", "1.0", "MIT", "", (), "manuscript-guide")]

        with pytest.raises(notices.NoticeError, match="bare"):
            notices.render_report(version="0.1.0", components=bare, program_license="AGPL", catalogs=[])
        assert "bare 1.0" in notices.render_report(version="0.1.0", components=bare, program_license="AGPL", catalogs=[], no_text_ok={"bare"})

    def test_source_files_named_licence_are_not_licence_files(self):
        for name in ("LICENSE", "LICENSE.txt", "LICENSE.md", "LICENSE-MIT", "COPYING", "COPYING.LESSER", "NOTICE", "LICENCE"):
            assert notices.LICENSE_FILE.match(name) and not notices.is_source_name(name), name
        for name in ("license.py", "license.go", "licensing.js", "LICENSE.pyc"):
            assert not notices.LICENSE_FILE.match(name) or notices.is_source_name(name), name

    def test_a_tagged_extension_module_belongs_to_its_package(self):
        toc = repr(([], [("_cffi_backend", win("C:/r/.venv/Lib/site-packages/_cffi_backend.cp312-win_amd64.pyd"), "EXTENSION")]))

        assert notices.read_frozen_toc(toc).modules == {"_cffi_backend"}

    def test_the_same_distribution_under_two_spellings_is_one_component(self):
        first = notices.Component("python", "piper-tts", "1.8.0", "GPL-3.0-or-later", "", ("t",), "manuscript-guide")
        second = notices.Component("python", "piper_tts", "1.8.0", "GPL-3.0-or-later", "", ("t",), "manuscript-guide")

        assert notices.collapse_spellings([first, second]) == [first]

    def test_a_vendored_native_folder_with_no_manual_entry_is_an_error(self):
        manual = [notices.Component("manual", "FFmpeg libraries (av.libs: avcodec)", "", "LGPL-3.0-or-later", "", ("n",), "")]

        notices.check_vendored({"av.libs"}, manual)
        with pytest.raises(notices.NoticeError, match="scipy.libs"):
            notices.check_vendored({"av.libs", "scipy.libs"}, manual)

    def test_the_environment_must_be_the_one_that_was_frozen(self):
        notices.check_frozen_version("numpy", "2.5.3", {"numpy": "2.5.3"})
        notices.check_frozen_version("numpy", "2.5.3", {})
        with pytest.raises(notices.NoticeError, match="numpy"):
            notices.check_frozen_version("numpy", "2.6.0", {"numpy": "2.5.3"})

    def test_copyleft_is_read_from_the_spdx_name_and_not_from_look_alike_letters(self):
        assert notices.is_copyleft("MPL-2.0") and notices.is_copyleft("LGPL-3.0-or-later") and notices.is_copyleft("GPL-2.0-or-later WITH Bootloader-exception")
        assert not notices.is_copyleft("BSD-2-Clause") and not notices.is_copyleft("Simplified BSD") and not notices.is_copyleft("MIT")


class TestReviewedFile:
    def test_reads_the_three_kinds_of_decision(self, tmp_path):
        path = tmp_path / "reviewed.json"
        path.write_text(json.dumps({"licenses": {"a": "MIT"}, "noText": {"b": "no file ships"}, "ignoredModules": ["c"]}), encoding="utf-8")

        assert notices.read_reviewed(path) == ({"a": "MIT"}, {"b"}, frozenset({"c"}))

    def test_a_missing_file_means_no_decisions(self, tmp_path):
        assert notices.read_reviewed(tmp_path / "nothing.json") == ({}, set(), frozenset())

    def test_a_no_text_entry_needs_its_reason(self, tmp_path):
        path = tmp_path / "reviewed.json"
        path.write_text(json.dumps({"noText": {"b": ""}}), encoding="utf-8")

        with pytest.raises(notices.NoticeError, match="b"):
            notices.read_reviewed(path)

    def test_the_committed_file_is_readable_and_every_entry_explains_itself(self):
        licenses, no_text, _ = notices.read_reviewed(REPO_ROOT / "scripts/licenses/reviewed.json")

        assert licenses and no_text


class TestReport:
    def sample(self):
        return [
            notices.Component("python", "numpy", "2.5.3", "BSD-3-Clause", "https://numpy.org", ("numpy licence text",), "manuscript-guide"),
            notices.Component("python", "piper-tts", "1.8.0", "GPL-3.0-or-later", "https://github.com/OHF-voice/piper1-gpl", ("GPL text",), "manuscript-guide"),
            notices.Component("npm", "react", "19.2.0", "MIT", "https://react.dev", ("react licence text",), "apps/ui"),
        ]

    def test_names_the_program_the_release_the_licence_and_where_the_source_is(self):
        text = notices.render_report(version="0.1.0", components=self.sample(), program_license="AGPL FULL TEXT", catalogs=[])

        assert "narration-utils 0.1.0" in text
        assert "AGPL-3.0-or-later" in text
        assert "https://github.com/countrymanprime/narration-utils" in text
        assert "v0.1.0" in text
        assert "AGPL FULL TEXT" in text

    def test_the_source_offer_names_the_tag_the_release_was_built_from(self):
        text = notices.render_report(version="0.1.0", components=self.sample(), program_license="AGPL", catalogs=[], tag="v0.1.0-rc")

        assert "at the tag v0.1.0-rc" in text

    def test_lists_every_component_with_its_licence_and_text_and_flags_the_copyleft_ones(self):
        text = notices.render_report(version="0.1.0", components=self.sample(), program_license="AGPL", catalogs=[])

        for needle in ("numpy 2.5.3", "BSD-3-Clause", "numpy licence text", "react 19.2.0", "react licence text", "piper-tts 1.8.0", "GPL text"):
            assert needle in text
        copyleft = text.split("Copyleft components")[1].split("=====")[0]
        assert "piper-tts" in copyleft
        assert "react" not in copyleft

    def test_refuses_to_write_a_report_with_an_unknown_licence_that_nobody_reviewed(self):
        unknown = [notices.Component("go", "example.com/mystery", "v1.0.0", "UNKNOWN", "", ("some text",), "apps/desktop")]

        with pytest.raises(notices.NoticeError, match="example.com/mystery"):
            notices.render_report(version="0.1.0", components=unknown, program_license="AGPL", catalogs=[])

    def test_an_unknown_licence_that_is_listed_as_reviewed_passes_with_the_reviewed_name(self):
        unknown = [notices.Component("go", "example.com/mystery", "v1.0.0", "UNKNOWN", "", ("some text",), "apps/desktop")]

        text = notices.render_report(version="0.1.0", components=unknown, program_license="AGPL", catalogs=[], reviewed={"example.com/mystery": "BSD-3-Clause"})

        assert "BSD-3-Clause" in text

    def test_says_which_downloaded_models_are_not_in_the_package(self):
        catalogs = [
            {"id": "tiny", "provider": "faster-whisper", "publisher": "Systran", "license": "MIT", "licenseUrl": "https://huggingface.co/x", "version": "abc"}
        ]

        text = notices.render_report(version="0.1.0", components=self.sample(), program_license="AGPL", catalogs=catalogs)

        assert "downloaded only when you ask" in text
        assert "faster-whisper/tiny" in text

    def test_missing_direct_dependencies_are_reported_by_name(self):
        components = self.sample()

        assert notices.missing_direct("npm", components, {"react", "zod"}) == {"zod"}
        assert notices.missing_direct("python", components, {"numpy"}) == set()


needs_pnpm = pytest.mark.skipif(shutil.which("pnpm") is None or not (REPO_ROOT / "apps/ui/node_modules").exists(), reason="pnpm or the UI install is not here")
needs_go = pytest.mark.skipif(shutil.which("go") is None, reason="go is not here")


@needs_pnpm
def test_the_real_npm_report_names_every_production_dependency_of_the_ui():
    package = json.loads((REPO_ROOT / "apps/ui/package.json").read_text(encoding="utf-8"))

    components = notices.npm_components(REPO_ROOT / "apps/ui")

    assert components, "an empty report is not a notice"
    assert notices.missing_direct("npm", components, set(package.get("dependencies", {}))) == set()
    assert not [c.name for c in components if c.license == "UNKNOWN"]


@needs_go
def test_the_real_go_report_names_every_direct_module_the_windows_build_links():
    components = notices.go_components(REPO_ROOT / "apps/desktop")
    direct = notices.go_direct_requirements((REPO_ROOT / "apps/desktop/go.mod").read_text(encoding="utf-8"))
    linked_direct = {name for name in direct if any(c.name == name for c in components) or name == "github.com/giraffesyo/pdf"}

    assert components, "an empty report is not a notice"
    # giraffesyo/pdf is behind the pdf_candidate build tag and is not in a shipped build (docs/architecture/threat-model.md, row 6a).
    assert notices.missing_direct("go", components, direct - {"github.com/giraffesyo/pdf"}) == set()
    assert linked_direct
