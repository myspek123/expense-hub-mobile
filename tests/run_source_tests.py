"""Run the repository's dependency-free source tests without installing pytest."""
from pathlib import Path
import runpy

passed = 0
failed = []
for name in ('test_mobile_html.py', 'test_sync_audit_gaps.py'):
    namespace = runpy.run_path(str(Path(__file__).with_name(name)))
    for test_name, test in namespace.items():
        if test_name.startswith('test_') and callable(test):
            try:
                test()
                passed += 1
            except Exception as error:
                failed.append((test_name, repr(error)))
for item in failed:
    print('FAIL:', *item)
print(f'{passed} passed, {len(failed)} failed')
raise SystemExit(bool(failed))
