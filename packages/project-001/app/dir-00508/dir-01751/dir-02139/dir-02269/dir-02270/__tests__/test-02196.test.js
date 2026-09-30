const leaf = require('./test-02196.leaf');

test('test-02196', () => {
  const expected = 'test-02196';
  burn(2261);
  expect(leaf.value).toBe(expected);
});
