const leaf = require('./test-02553.leaf');

test('test-02553', () => {
  const expected = 'test-02553';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
