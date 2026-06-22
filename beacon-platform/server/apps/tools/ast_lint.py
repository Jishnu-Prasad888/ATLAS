"""Simple AST lint to block dangerous constructs in sandboxed code."""

from __future__ import annotations

import ast
from typing import Set


FORBIDDEN_IMPORTS: Set[str] = {
    "os",
    "subprocess",
    "socket",
    "shlex",
    "pathlib",
    "sys",
    "importlib",
    "builtins",
}

FORBIDDEN_NAMES: Set[str] = {
    "eval",
    "exec",
    "open",
    "__import__",
    "compile",
    "input",
    "globals",
    "locals",
    "exit",
    "quit",
}


class AstForbiddenError(Exception):
    pass


class _Visitor(ast.NodeVisitor):
    def visit_Import(self, node: ast.Import):  # noqa: N802
        for alias in node.names:
            if alias.name.split(".")[0] in FORBIDDEN_IMPORTS:
                raise AstForbiddenError(f"Import of '{alias.name}' is not allowed")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):  # noqa: N802
        if node.module and node.module.split(".")[0] in FORBIDDEN_IMPORTS:
            raise AstForbiddenError(f"Import of '{node.module}' is not allowed")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):  # noqa: N802
        if isinstance(node.attr, str) and node.attr in FORBIDDEN_NAMES:
            raise AstForbiddenError(f"Usage of '{node.attr}' is not allowed")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name):  # noqa: N802
        if node.id in FORBIDDEN_NAMES:
            raise AstForbiddenError(f"Usage of '{node.id}' is not allowed")
        self.generic_visit(node)


def lint_code(code: str) -> None:
    tree = ast.parse(code)
    _Visitor().visit(tree)
