import { URL } from 'node:url';

/**
 * Which hosts an `explainers` entry may point at, per kind (ADR-0017).
 *
 * SHARED BETWEEN THE TWO CHECKS ON PURPOSE. `validate:content` rejects a
 * disallowed host offline, naming the file and the field; `check:explainers`
 * picks the verification strategy from the same `kind`. Two copies of this
 * table would let the validator accept a host the checker has no way to verify,
 * and the corpus would fill with entries that pass one gate and are
 * unverifiable at the other — the shape `ConceptPrefix` was factored out of
 * `store` to prevent, after Fake and Firestore disagreed about it.
 *
 * AN ALLOWLIST, NOT A DENYLIST, and the two kinds earn their places differently.
 *
 * `video` is checked through YouTube's oEmbed endpoint, which exists for exactly
 * one host. A video anywhere else could be recorded and never verified, and an
 * unverifiable link is what ADR-0013 keeps out of `citations`.
 *
 * `read` is fetched, so the bar is that the host KEEPS ITS URLS. Every one below
 * is a stable publication rather than a feed: a lecture page that moves every
 * term is link rot with a syllabus. Wikipedia and paperswithcode are
 * deliberately absent — good references, but this field is a named person
 * teaching, and neither has an author to check.
 */
export const EXPLAINER_HOSTS = {
  video: ['youtube.com', 'youtu.be'],
  read: [
    'colah.github.io',
    'course.fast.ai',
    'cs231n.github.io',
    'cs231n.stanford.edu',
    'd2l.ai',
    'distill.pub',
    'huggingface.co',
    'jalammar.github.io',
    'karpathy.ai',
    'lilianweng.github.io',
    'pytorch.org',
    'sebastianraschka.com',
    'simonwillison.net',
    'thegradient.pub',
  ],
};

/** The host as the allowlist spells it: no `www.`, lowercased. */
export function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}
