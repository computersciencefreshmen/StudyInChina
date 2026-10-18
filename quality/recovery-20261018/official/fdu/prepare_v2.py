"""Preserve the independent-review correction without overwriting draft v1."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
original = directory / 'full-program-batch-draft.json'
expected = 'beb7d6ab26ee8ecd3e705a72b68ed45e50a93771d3070975fd4bf88c83b7b6fc'
assert hashlib.sha256(original.read_bytes()).hexdigest() == expected
batch = json.loads(original.read_text(encoding='utf-8'))
batch['batchId'] = 'recovery-fdu-chinese-language-spring-2027-20261018-v2'
entry = batch['entries'][0]
assert entry['reviewer'] == 'pending-independent-review' and entry['reviewedAt'] is None
details = entry['program']['supplementaryDetails']
details['eligibility'][1]['en'] = details['eligibility'][1]['en'].replace('with a source of income', 'with a stable source of income')
details['eligibility'][1]['zh'] = details['eligibility'][1]['zh'].replace('有经济来源的成年人', '有经济来源的成年人（英文版注明应为稳定收入来源）')
details['applicationMaterials'][3]['en'] = details['applicationMaterials'][3]['en'].replace('have a source of income', 'have a stable source of income')
details['applicationMaterials'][3]['zh'] = details['applicationMaterials'][3]['zh'].replace('有经济来源。', '有经济来源（英文版注明应为稳定收入来源）。')
output = directory / 'full-program-batch-draft-v2.json'
with output.open('x', encoding='utf-8', newline='\n') as target:
    json.dump(batch, target, ensure_ascii=False, indent=2)
    target.write('\n')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
with (directory / 'batch-revision-v2.json').open('x', encoding='utf-8', newline='\n') as target:
    json.dump({'revisedAt': datetime.now(timezone.utc).isoformat(), 'originalBatchSha256': expected, 'revisedBatchSha256': digest, 'reason': 'Independent reviewer found the English guarantor condition requires a stable source of income. Restore that qualifier in eligibility and material instructions; the Chinese text discloses the stricter English wording. No other program, cycle, source, capture or proof changes.', 'independentReview': 'pending'}, target, ensure_ascii=False, indent=2)
    target.write('\n')
print(digest)
