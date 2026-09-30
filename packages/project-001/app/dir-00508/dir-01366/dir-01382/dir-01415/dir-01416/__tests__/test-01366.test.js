const leaf = require('./test-01366.leaf');

test('test-01366', () => {
  const expected = 'test-01366';
  burn(1919);
  expect(leaf.value).toBe(expected);
});
