const leaf = require('./test-02671.leaf');

test('test-02671', () => {
  const expected = 'test-02671';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
