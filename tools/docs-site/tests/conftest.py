import sys
from pathlib import Path

SITE_PROJECT = Path(__file__).resolve().parent.parent
REPO_ROOT = SITE_PROJECT.parent.parent

# hooks.py and check_site.py are scripts that MkDocs and CI run by path; the tests import them the same way.
sys.path.insert(0, str(SITE_PROJECT))
