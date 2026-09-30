const leaf = require('./test-02256.leaf');

test('test-02256', () => {
  const expected = 'test-02256';
  burn(1968);
  expect(leaf.value).toBe(expected);
});
