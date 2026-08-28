# The H3 contract

**[contract.json](./contract.json) is the machine-readable spec. Read it before auditing, changing, or adding a prompt.** It states, per mode, what the output must look like; what vocabulary is legal and which guide line each value comes from; what blocks each system prompt carries and in what order; every diagnostic and why it is legitimate; and everything the compiler does that no guide asks for.

`test/contract.test.ts` binds every field in it to the implementation, in both directions: code that drifts from the spec fails, and a spec that misdescribes the code fails. It is not generated from the source -- a spec derived from the implementation agrees with it by construction and would catch nothing.

The two files it is a spec *of*:

| File | Covers |
| --- | --- |
| [VIDEO_PROMPT_WRITING_GUIDE_base_en.md](./VIDEO_PROMPT_WRITING_GUIDE_base_en.md) | T2VA, I2VA, FL2VA, L2VA |
| [VIDEO_PROMPT_WRITING_GUIDE_ref_en.md](./VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) | Ref2VA, the full-reference rewrite format |

Do not edit those two. They are someone else's specification, their hashes are recorded in `contract.json`, and an edit does not change what H3 does -- it only makes the tests agree with a contract that no longer exists. If MiniMax publishes a revision: replace the whole file, update the hash, and let the golden tests report everything the revision changed.

Two rewrite documents sat beside these and were not moved. They are secondary sources rather than the contract, and they remain untracked. When any secondary source disagrees with these two files, these two win.
