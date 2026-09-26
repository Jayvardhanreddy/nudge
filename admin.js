document.addEventListener('DOMContentLoaded', async () => {
  const headers = { 'Authorization': `Bearer ${localStorage.getItem('comment2dm_token') || ''}`, 'Content-Type': 'application/json' };

  // Auth Check
  try {
    const res = await fetch('/api/me', { headers });
    const data = await res.json();
    if (!res.ok || !data.user || !data.user.isAdmin) {
      window.location.href = 'dashboard.html';
      return;
    }
  } catch (err) {
    window.location.href = 'login.html';
    return;
  }

  // Load Data
  async function loadData() {
    try {
      const [usersRes, healthRes, revRes, configRes, supportRes] = await Promise.all([
        fetch('/api/admin/users', { headers }).then(r => r.json()),
        fetch('/api/admin/health', { headers }).then(r => r.json()),
        fetch('/api/admin/revenue', { headers }).then(r => r.json()),
        fetch('/api/admin/config', { headers }).then(r => r.json()),
        fetch('/api/admin/contacts', { headers }).then(r => r.json())
      ]);

      // Health
      const h = document.getElementById('kpiHealth');
      if (healthRes.api && healthRes.database) {
        h.innerHTML = `<span class="health-status"></span> All Systems Operational (${healthRes.latency}ms)`;
      } else {
        h.innerHTML = `<span class="health-status offline"></span> Degraded`;
      }

      // Users
      if (usersRes.users) {
        document.getElementById('kpiUsers').textContent = usersRes.users.length;
        const tb = document.getElementById('usersTableBody');
        tb.innerHTML = usersRes.users.map(u => `
          <tr>
            <td>
              <strong>${u.name || 'Unknown'}</strong><br>
              <span style="font-size:0.8rem; color:var(--ink-secondary);">${u.email}</span>
            </td>
            <td>${new Date(u.created_at).toLocaleDateString()}</td>
            <td>
              <select onchange="changePlan('${u._id}', this.value)">
                <option value="free" ${u.plan === 'free' ? 'selected' : ''}>Free</option>
                <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro</option>
                <option value="elite" ${u.plan === 'elite' ? 'selected' : ''}>Elite</option>
              </select>
            </td>
            <td>
              <span style="color: ${u.suspended ? '#f43f5e' : '#10b981'}">${u.suspended ? 'Suspended' : 'Active'}</span>
            </td>
            <td>
              <button onclick="toggleSuspend('${u._id}')" class="btn btn-ghost btn-sm" style="color: ${u.suspended ? '#10b981' : '#f43f5e'};">
                ${u.suspended ? 'Unsuspend' : 'Suspend'}
              </button>
            </td>
          </tr>
        `).join('');
      }

      // Revenue
      if (revRes.months) {
        const total = revRes.months.reduce((sum, m) => sum + m.total, 0);
        document.getElementById('kpiRevenue').textContent = `₹${total.toLocaleString('en-IN')}`;
      }

      // Config (Pricing/Coupons)
      if (configRes.prices) {
        document.getElementById('priceProM').value = configRes.prices.pro_monthly || 999;
        document.getElementById('priceEliteM').value = configRes.prices.elite_monthly || 2499;
      }
      if (configRes.coupons) {
        document.getElementById('couponsTableBody').innerHTML = configRes.coupons.length === 0 ? '<tr><td colspan="3">No active coupons</td></tr>' : 
          configRes.coupons.map(c => `
            <tr>
              <td><strong>${c.code}</strong></td>
              <td>${c.discount}% Off</td>
              <td><button onclick="deleteCoupon('${c.code}')" class="btn btn-ghost btn-sm" style="color:#f43f5e;">Remove</button></td>
            </tr>
          `).join('');
      }

      // Support
      if (supportRes.contacts) {
        document.getElementById('supportTableBody').innerHTML = supportRes.contacts.map(c => `
          <tr style="${c.resolved ? 'opacity: 0.5;' : ''}">
            <td>${new Date(c.created_at).toLocaleDateString()}</td>
            <td>${c.name}<br><small>${c.email}</small></td>
            <td>${c.subject}</td>
            <td>${c.message}</td>
            <td>
              ${c.resolved ? 'Resolved' : `<button onclick="resolveContact('${c._id}')" class="btn btn-primary btn-sm">Mark Resolved</button>`}
            </td>
          </tr>
        `).join('');
      }

    } catch (err) {
      console.error(err);
    }
  }

  loadData();

  // Actions
  window.changePlan = async (id, plan) => {
    await fetch(`/api/admin/users/${id}/plan`, { method: 'PATCH', headers, body: JSON.stringify({ plan }) });
  };
  window.toggleSuspend = async (id) => {
    await fetch(`/api/admin/users/${id}/suspend`, { method: 'PATCH', headers });
    loadData();
  };
  window.resolveContact = async (id) => {
    await fetch(`/api/admin/contacts/${id}/resolve`, { method: 'PATCH', headers });
    loadData();
  };
  window.deleteCoupon = async (code) => {
    await fetch(`/api/admin/config/coupon/${code}`, { method: 'DELETE', headers });
    loadData();
  };

  document.getElementById('pricesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pro = document.getElementById('priceProM').value;
    const elite = document.getElementById('priceEliteM').value;
    await fetch('/api/admin/config/prices', { 
      method: 'POST', headers, 
      body: JSON.stringify({ pro_monthly: Number(pro), elite_monthly: Number(elite) }) 
    });
    alert('Prices updated!');
  });

  document.getElementById('couponForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('newCouponCode').value.toUpperCase();
    const discount = document.getElementById('newCouponDiscount').value;
    await fetch('/api/admin/config/coupon', { 
      method: 'POST', headers, 
      body: JSON.stringify({ code, discount: Number(discount) }) 
    });
    document.getElementById('newCouponCode').value = '';
    document.getElementById('newCouponDiscount').value = '';
    loadData();
  });
});
