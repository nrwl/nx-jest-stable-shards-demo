const leaf = require('./test-02903.leaf');

test('test-02903', () => {
  const expected = 'test-02903';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
