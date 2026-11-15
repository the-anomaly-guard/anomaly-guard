// The group behind the project, listed on the About page (pages/about.js). Public pages name the
// members only by their GitHub nickname, with a link to the profile: to add or remove a member,
// change this list. Pure: no DOM, tested in Node.

/** GitHub nicknames of the members, in alphabetical order (ignoring case). */
export const TEAM = Object.freeze([
  'giuseppe1-1',
  'marcelloNapoletano',
  'Nicholas-Arcari',
  'Sangioo',
]);

/**
 * A member's GitHub profile.
 * @param {string} nickname
 * @returns {string}
 */
export function profileUrl(nickname) {
  return `https://github.com/${encodeURIComponent(nickname)}`;
}
