const leaf = require('./test-02368.leaf');

test('test-02368', () => {
  const expected = 'test-02368';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
