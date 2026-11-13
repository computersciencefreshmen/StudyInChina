# Public official-source byte fixtures

These eight gzip files preserve exact downloaded raw/text/snapshot bytes used by the pinned three-job no-replay policy. Tests decompress and verify actual SHA-256 rather than mocking crypto or reconstructing parser metadata. They contain public official school content and its small capture metadata, not model outputs, DO reservations, credentials, billing data or a finalized migration snapshot.

Original sources:

- `https://admission.blcu.edu.cn/en/384/list.htm` — raw `016d37595e985e9e5c33d4d9825a80753e8461857cc3ac4e3aab3f5ca2ed2f96`, 126612 bytes.
- `https://iczu.zju.edu.cn/admissionsen/2022/0531/c95474a2590758/page.htm` — raw `1b015e5a230616a2a5eef1235d5c7a8c4bb9576fb5422502ef8b96411c8de86e`, 26884 bytes.
- `https://admission.blcu.edu.cn/en/39/list.htm` — raw `5e0be83cd566f91c3e275eddec6e769a939aa249d3669235445111677c24ad86`, 126600 bytes.

The BLCU files share complete text hash `1a6a30008383c28f866802fc9d9b406dd9600044cecc3dc8a1945315693c085a` (10364 bytes). ZJU text hash is `0ef937e70976197cee219d1d939a5ae59005e6878662bf7e21de5f483965a317` (1027 bytes). The three original snapshot JSON hashes and source/key bindings are pinned separately in the policy.

Downloads were authorized read-only from source preflight evidence on 2026-11-13 UTC. Raw/text receipt SHA: `a37e3d4d546e6989fcd515fcb4cc053f0408f9b85c921a3e9a0569f9141ef024`. Snapshot receipt SHA: `2d24db401d0b38256d3d73672e005f68839942df58995db84ff5221b58c68715`. These identify provenance only; those private operational receipts are not bundled. The gzip size is 35768 bytes in total. All school content remains attributable to its original publisher; fixtures are retained only for narrow integrity regression testing.
