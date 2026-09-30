const leaf = require('./test-02827.leaf');

test('test-02827', () => {
  const expected = 'test-02827';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
