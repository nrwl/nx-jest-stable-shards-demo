const leaf = require('./test-02598.leaf');

test('test-02598', () => {
  const expected = 'test-02598';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
