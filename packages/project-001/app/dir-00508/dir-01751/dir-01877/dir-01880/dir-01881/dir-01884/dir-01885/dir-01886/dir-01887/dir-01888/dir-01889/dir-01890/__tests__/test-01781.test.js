const leaf = require('./test-01781.leaf');

test('test-01781', () => {
  const expected = 'test-01781';
  burn(5569);
  expect(leaf.value).toBe(expected);
});
