def patch_pydantic_is_new_type():
    try:
        from pydantic._internal import _typing_extra
        if not hasattr(_typing_extra, "is_new_type"):
            def is_new_type(tp):  # type: ignore[return-type]
                return False
            _typing_extra.is_new_type = is_new_type  # type: ignore[attr-defined]
    except Exception:
        pass


patch_pydantic_is_new_type()
