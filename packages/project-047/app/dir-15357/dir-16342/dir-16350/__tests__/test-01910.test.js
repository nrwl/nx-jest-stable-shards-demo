const leaf = require('./test-01910.leaf');

test('test-01910', () => {
  const expected = 'test-01910';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
