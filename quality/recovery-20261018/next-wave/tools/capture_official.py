"""Reuse the existing bounded, robots-aware capture implementation for two schools."""
from pathlib import Path
import importlib.util

root = Path(__file__).resolve().parents[4]
path = root / "quality/recovery-20261018/official/sjtu/capture_official_direct.py"
spec = importlib.util.spec_from_file_location("existing_bounded_capture", path)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
capture.BASE = Path(__file__).resolve().parent.parent
capture.SOURCES = {
    "ecnu-gcp-2027": ("ecnu", "https://lxs.ecnu.edu.cn/en_admission_visiting_programs_global_china_program/list.htm", "html"),
    "ecnu-standard-2027": ("ecnu", "https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_standard_chinese_language_program/list.htm", "html"),
    "ecnu-intensive-2027": ("ecnu", "https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_intensive_chinese_language_program/list.htm", "html"),
    "ecnu-apply-https": ("ecnu", "https://lxsapply.ecnu.edu.cn/", "html"),
    "tongji-current-period": ("tongji", "https://study.tongji.edu.cn/info/1010/1182.htm", "html"),
    "tongji-language-guide": ("tongji", "https://study.tongji.edu.cn/info/1061/1568.htm", "html"),
    "tongji-language-brochure": ("tongji", "https://study.tongji.edu.cn/__local/F/B5/C2/33F541911754CBAFDC0717991B9_BE10EB99_412058.pdf", "pdf"),
}
capture.main()
