type Props = { value: number }
export default function StarRating({ value }: Props) {
  const stars = Array.from({ length: 5 }, (_, i) => i < Math.round(value))
  return (
    <div className="flex items-center gap-1">
      {stars.map((filled, i) => (
        <svg key={i} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" className={`w-4 h-4 ${filled ? 'text-[#517ea0]' : 'text-neutral-300'}`}> 
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.48 3.5a.75.75 0 011.04 0l2.42 2.47c.21.21.5.32.79.28l3.41-.51a.75.75 0 01.83.94l-1.19 3.29a.75.75 0 00.21.79l2.54 2.36a.75.75 0 01-.38 1.29l-3.41.62a.75.75 0 00-.6.56l-.86 3.38a.75.75 0 01-1.17.44l-2.86-2.03a.75.75 0 00-.88 0l-2.86 2.03a.75.75 0 01-1.17-.44l-.86-3.38a.75.75 0 00-.6-.56l-3.41-.62a.75.75 0 01-.38-1.29l2.54-2.36a.75.75 0 00.21-.79L4.03 7.68a.75.75 0 01.83-.94l3.41.51c.29.04.58-.07.79-.28l2.42-2.47z" />
        </svg>
      ))}
    </div>
  )
}
