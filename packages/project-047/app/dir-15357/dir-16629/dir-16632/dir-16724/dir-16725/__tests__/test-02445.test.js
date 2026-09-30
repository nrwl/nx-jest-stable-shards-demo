const leaf = require('./test-02445.leaf');

test('test-02445', () => {
  const expected = 'test-02445';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
