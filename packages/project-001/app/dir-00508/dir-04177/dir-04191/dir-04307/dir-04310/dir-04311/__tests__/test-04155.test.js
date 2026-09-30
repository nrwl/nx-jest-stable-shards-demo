const leaf = require('./test-04155.leaf');

test('test-04155', () => {
  const expected = 'test-04155';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
