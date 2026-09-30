const leaf = require('./test-02909.leaf');

test('test-02909', () => {
  const expected = 'test-02909';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
