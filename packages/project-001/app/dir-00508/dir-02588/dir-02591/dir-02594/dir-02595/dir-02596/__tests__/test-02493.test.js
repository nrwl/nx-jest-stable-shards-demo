const leaf = require('./test-02493.leaf');

test('test-02493', () => {
  const expected = 'test-02493';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
