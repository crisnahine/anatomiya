/**
 * A stretch of source turned to spaces, with its line breaks kept.
 *
 * The text keeps its length in UTF-16 units and every line it had, so an
 * offset or a line a parser reports on the result is the file's own. A leaf:
 * both parser children read it, through the C# directive blanker and the
 * script-block scanner.
 */
export const blank = (text) => text.replace(/[^\n\r]/g, " ");
