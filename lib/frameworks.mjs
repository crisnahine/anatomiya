/**
 * The framework profiles: the signal each framework leaves in a corpus.
 *
 * A framework matters because some claims are its and cannot be judged without
 * it: `Time.now` is a drifting timestamp under Rails and correct in plain
 * Ruby, and one file carries no marker saying which it is standing in (C8).
 * One profile per framework, folded as a set, so a corpus holding two
 * frameworks reports both: the old reading broke on the first hit behind a
 * language gate, which made a second framework unreportable by construction.
 *
 * A leaf. `dimensions.mjs` holds the `framework` field to the names declared
 * here, so a row naming a framework nobody can detect refuses to load.
 */

/**
 * Rails, by the shape its tree cannot avoid.
 *
 * Read from the corpus, never from `git ls-files`: rubocop's only app/models
 * files are three fixtures under spec/fixtures, which the corpus already
 * drops, and the raw list calls rubocop a Rails application. Measured across
 * 19 Ruby repositories, this separates 14 Rails from 5 plain with no error,
 * decidim included, whose engines keep the shape without a
 * config/application.rb.
 */
const rails = Object.freeze({
  name: "rails",
  // The signal is a Ruby fact: a JavaScript file under app/models is somebody
  // else's convention, not a Rails tree.
  lang: "ruby",
  shape: /(^|\/)(app\/models\/|db\/migrate\/|config\/application\.rb$)/,
});

export const FRAMEWORKS = Object.freeze([rails]);

export const FRAMEWORK_NAMES = Object.freeze(FRAMEWORKS.map((f) => f.name));

/** Whether any profile could signal from a file of this language. */
export const couldSignal = (lang) => FRAMEWORKS.some((fw) => !fw.lang || fw.lang === lang);
