const leaf = require('./test-02521.leaf');

test('test-02521', () => {
  const expected = 'test-02521';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
