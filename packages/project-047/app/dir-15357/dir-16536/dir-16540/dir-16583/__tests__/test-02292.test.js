const leaf = require('./test-02292.leaf');

test('test-02292', () => {
  const expected = 'test-02292';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
