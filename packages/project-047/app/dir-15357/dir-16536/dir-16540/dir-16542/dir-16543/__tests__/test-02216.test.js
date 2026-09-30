const leaf = require('./test-02216.leaf');

test('test-02216', () => {
  const expected = 'test-02216';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
