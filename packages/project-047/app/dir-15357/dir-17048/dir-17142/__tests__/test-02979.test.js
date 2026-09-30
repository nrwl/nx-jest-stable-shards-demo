const leaf = require('./test-02979.leaf');

test('test-02979', () => {
  const expected = 'test-02979';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
