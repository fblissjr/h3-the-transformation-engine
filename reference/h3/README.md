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

The hazard is a secondary source shaped like a primary one. An annotated copy of the base guide turned up with its field descriptions rewritten -- `overall_soundscape` cut from the guide's 1-4 sentences to one, `non_diegetic_music` given a default of `N/A` -- and empirical claims added around worked examples left intact. It is larger than the official file, so it presents as the complete version of something that looks truncated. Its worked examples were untouched, and when that copy was put through `test/guide-fidelity.test.ts` all four base-guide fixtures matched it byte for byte: that file checks transcription of the examples, not the identity of the document holding them. The copy is not tracked here, so that is a recorded observation rather than something a checkout can re-derive. The sha256 pin is the only thing that tells the two apart, which is why replacing a guide means replacing the whole file and updating the hash deliberately, never dropping in a copy that looks like more of the same.

The pin now has a second, independent instance to check against. MiniMax ships these same two files as the `references/` of its own `h3-prompt-writing` skill, in the `MiniMax-AI/MiniMax-H3` repository, under the names `base-en.txt` and `ref-en.txt`. Both hash to the values recorded in `contract.json`. So the source of truth this compiler is built on and the source of truth the model's publisher hands to agents are the same bytes, and that is re-derivable by anyone who clones that repository. What ships around them is not contract: the skill is a router that says which guide to read, and the longer of its two copies carries a handful of added tips, one of which is unsupported by either guide and one of which the base guide's own worked examples contradict. The pattern is the padded copy again -- added prose accreting around an intact primary source -- so the same discipline applies to first-party material.

The padded base guide has since been seen again, vendored inside a third-party kit as `guide_base_en.md`: 34 lines added against the tracked file, section 4.7 rewritten to make `N/A` the normal answer in one sentence rather than the guide's conditional in 1-3, with hit-rate figures attached that cite nothing. Its ref guide is byte-identical to the pin, which is what makes the pair convincing. That kit is not tracked here either, so this remains a recorded observation rather than something a checkout can re-derive -- the pin is still what separates them.
