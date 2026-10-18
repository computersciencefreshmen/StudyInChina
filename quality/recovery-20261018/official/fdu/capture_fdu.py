"""Exact-allowlist Fudan recovery captures using the reviewed bounded fetcher."""
import importlib.util
from pathlib import Path

script = Path(__file__).resolve().parent.parent / 'shu/capture_official.py'
spec = importlib.util.spec_from_file_location('official_capture', script)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
capture.SOURCES = {
    'fdu-ices-index': ('fdu', 'https://ices.fudan.edu.cn/_t326/69/08/c6658a485640/page.htm', 'html'),
    'fdu-spring-2027-en': ('fdu', 'https://ices.fudan.edu.cn/_upload/article/files/9e/6d/2ced2d9b44efbf4f18ad73e0e179/7cb8d8f0-d3cb-436c-87e6-4ffb406b5737.pdf', 'pdf'),
    'fdu-spring-2027-zh': ('fdu', 'https://ices.fudan.edu.cn/_upload/article/files/9e/6d/2ced2d9b44efbf4f18ad73e0e179/15500f02-6855-4d61-8b60-b2eff5c90917.pdf', 'pdf'),
    'fdu-iso-index': ('fdu', 'https://iso.fudan.edu.cn/isoenglish/wonwwegree/list.psp/1000/main.psp', 'html'),
}
capture.main()
