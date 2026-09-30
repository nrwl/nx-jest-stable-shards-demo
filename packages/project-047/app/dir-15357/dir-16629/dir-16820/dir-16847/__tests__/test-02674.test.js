const leaf = require('./test-02674.leaf');

test('test-02674', () => {
  const expected = 'test-02674';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
