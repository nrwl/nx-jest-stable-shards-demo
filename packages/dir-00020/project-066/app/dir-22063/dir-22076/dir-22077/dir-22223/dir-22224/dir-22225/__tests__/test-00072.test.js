const leaf = require('./test-00072.leaf');

test('test-00072', () => {
  const expected = 'test-00072';
  burn(26801);
  expect(leaf.value).toBe(expected);
});
