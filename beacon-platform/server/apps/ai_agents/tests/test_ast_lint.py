import pytest

from apps.tools.ast_lint import lint_code, AstForbiddenError


def test_lint_allows_safe_code():
    lint_code("result = 1+1")


@pytest.mark.parametrize("snippet", [
    "import os",
    "from subprocess import Popen",
    "eval('1+1')",
    "open('x')",
])
def test_lint_blocks_forbidden(snippet):
    with pytest.raises(AstForbiddenError):
        lint_code(snippet)
